import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';

// --- File Extension Helper ---
const getFileInfo = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return { type: 'image', icon: '🖼️' };
  if (['mp4', 'webm', 'mkv', 'avi'].includes(ext)) return { type: 'video', icon: '🎥' };
  if (['mp3', 'wav', 'ogg'].includes(ext)) return { type: 'audio', icon: '🎵' };
  if (['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) return { type: 'archive', icon: '📦' };
  if (['pdf'].includes(ext)) return { type: 'pdf', icon: '📕' };
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'lua'].includes(ext)) return { type: 'code', icon: '📝' };
  
  return { type: 'text', icon: '📄' };
};

export default function Dashboard({ onLogout }) {
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState(() => sessionStorage.getItem('vps_currentPath') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Advanced States
  const [editorState, setEditorState] = useState({ isOpen: false, filePath: '', content: '', isSaving: false });
  const [mediaViewer, setMediaViewer] = useState({ isOpen: false, url: '', filename: '', type: '' });
  
  const [modal, setModal] = useState({ isOpen: false, type: '', input: '', error: '', targetPath: '' });
  const [clipboard, setClipboard] = useState(null);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, file: null });

  useEffect(() => {
    sessionStorage.setItem('vps_currentPath', currentPath);
    fetchFiles(currentPath);
  }, [currentPath]);

  useEffect(() => {
    const handleClick = () => setContextMenu({ visible: false, x: 0, y: 0, file: null });
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const fetchFiles = async (path) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('vps_token');
      const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 401 || response.status === 403) return onLogout();

      const rawText = await response.text();
      let data = {};
      if (rawText) {
        try { data = JSON.parse(rawText); } 
        catch { throw new Error('Unexpected server response'); }
      }
      if (!response.ok) throw new Error(data.error || 'Failed to fetch files');
      setFiles(data.files || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const navigateUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    setModal(prev => ({ ...prev, error: '' }));
    if (!modal.input.trim()) return setModal(prev => ({ ...prev, error: 'Name cannot be empty' }));

    try {
      const token = localStorage.getItem('vps_token');
      let endpoint, body, method = 'POST';

      if (modal.type === 'rename') {
        endpoint = '/api/files/rename';
        method = 'PUT';
        body = { oldPath: modal.targetPath, newName: modal.input };
      } else {
        endpoint = modal.type === 'folder' ? '/api/files/folder' : '/api/files/text';
        body = modal.type === 'folder' ? { currentPath, folderName: modal.input } : { currentPath, fileName: modal.input };
      }

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error((await res.json()).error || `Failed operation`);
      setModal({ isOpen: false, type: '', input: '', error: '', targetPath: '' });
      fetchFiles(currentPath);
    } catch (err) { setModal(prev => ({ ...prev, error: err.message })); }
  };

  const handleAction = async (action, file) => {
    const token = localStorage.getItem('vps_token');

    if (action === 'open') {
      if (file.isDirectory) return setCurrentPath(file.path);
      
      const fileInfo = getFileInfo(file.name);
      
      if (fileInfo.type === 'image' || fileInfo.type === 'pdf') {
        try {
          const res = await fetch(`/api/files/download?path=${encodeURIComponent(file.path)}`, { headers: { 'Authorization': `Bearer ${token}` }});
          if (!res.ok) throw new Error('Failed to load file');
          const blob = await res.blob();
          const typedBlob = new Blob([blob], { type: fileInfo.type === 'pdf' ? 'application/pdf' : blob.type });
          const url = URL.createObjectURL(typedBlob);
          setMediaViewer({ isOpen: true, url, filename: file.name, type: fileInfo.type, isBlob: true });
        } catch (err) { alert(err.message); }
      } 
      else if (fileInfo.type === 'video' || fileInfo.type === 'audio') {
        // Stream directly using the URL token instead of loading into RAM
        const url = `/api/files/download?path=${encodeURIComponent(file.path)}&token=${token}`;
        setMediaViewer({ isOpen: true, url, filename: file.name, type: fileInfo.type, isBlob: false });
      } 
      else if (fileInfo.type === 'code' || fileInfo.type === 'text') {
        openFile(file.path);
      } 
      else {
        alert(`Cannot preview ${fileInfo.type} files yet.`);
      }
    }
    else if (action === 'rename') setModal({ isOpen: true, type: 'rename', input: file.name, error: '', targetPath: file.path });
    else if (action === 'copy') setClipboard(file.path);
    else if (action === 'delete') {
      if (!window.confirm(`Are you sure you want to permanently delete "${file.name}"?`)) return;
      try {
        await fetch('/api/files/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ filePath: file.path }) });
        fetchFiles(currentPath);
      } catch (err) { alert('Failed to delete file'); }
    }
    else if (action === 'download') {
      try {
        const token = localStorage.getItem('vps_token');
        const res = await fetch(`/api/files/export?path=${encodeURIComponent(file.path)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to download item');
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.isDirectory ? `${file.name}.zip` : file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handlePaste = async () => {
    if (!clipboard) return;
    try {
      const token = localStorage.getItem('vps_token');
      const res = await fetch('/api/files/copy', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ sourcePath: clipboard, destinationDir: currentPath }) });
      if (res.ok) { setClipboard(null); fetchFiles(currentPath); } 
      else throw new Error((await res.json()).error);
    } catch (err) { alert('Failed to paste: ' + err.message); }
  };

  const openFile = async (filePath) => {
    try {
      const token = localStorage.getItem('vps_token');
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`, { headers: { 'Authorization': `Bearer ${token}` }});
      const rawText = await res.text();
      const data = JSON.parse(rawText);
      if (!res.ok) throw new Error(data.error);
      setEditorState({ isOpen: true, filePath, content: data.content || '', isSaving: false });
    } catch (err) { setError(err.message); }
  };

  const saveFile = async () => {
    setEditorState(prev => ({ ...prev, isSaving: true }));
    try {
      const token = localStorage.getItem('vps_token');
      const res = await fetch('/api/files/update', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ filePath: editorState.filePath, content: editorState.content }) });
      if (!res.ok) throw new Error('Failed to save file');
      alert('Saved successfully!');
    } catch (err) { alert(err.message); } 
    finally { setEditorState(prev => ({ ...prev, isSaving: false })); }
  };

  // --- Editor View ---
  if (editorState.isOpen) {
    const lang = editorState.filePath.split('.').pop().toLowerCase();
    const map = { js: 'javascript', json: 'json', html: 'html', css: 'css', py: 'python', lua: 'lua' };
    return (
      <div className="dashboard-container" style={{ display: 'flex', flexDirection: 'column', height: '80vh' }}>
        <div className="controls-bar" style={{ marginBottom: '10px' }}>
          <span>Editing: {editorState.filePath}</span>
          <div className="action-buttons">
            <button className="action-btn btn-secondary" onClick={() => setEditorState({ isOpen: false })}>Close</button>
            <button className="action-btn" onClick={saveFile} disabled={editorState.isSaving}>Save</button>
          </div>
        </div>
        <div style={{ flexGrow: 1, border: '1px solid #333', borderRadius: '8px', overflow: 'hidden' }}>
          <Editor height="100%" theme="vs-dark" language={map[lang] || 'plaintext'} value={editorState.content} onChange={v => setEditorState(prev => ({ ...prev, content: v }))} options={{ minimap: { enabled: false } }} />
        </div>
      </div>
    );
  }

  // --- Main Explorer View ---
  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>File Explorer</h2>
        <button onClick={onLogout} className="logout-btn">Log Out</button>
      </div>
      
      <div className="controls-bar">
        <div className="breadcrumbs">
          <button className="back-btn" onClick={navigateUp} disabled={!currentPath}>&#8592; Up</button>
          <span>Root {currentPath ? `/ ${currentPath}` : ''}</span>
        </div>
        <div className="action-buttons">
          {clipboard && <button className="action-btn" style={{ backgroundColor: '#2e7d32' }} onClick={handlePaste}>📋 Paste Here</button>}
          <button className="action-btn" onClick={() => setModal({ isOpen: true, type: 'folder', input: '' })}>+ Folder</button>
          <button className="action-btn" onClick={() => setModal({ isOpen: true, type: 'text', input: '' })}>+ File</button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      
      {loading ? ( <div className="loading-state">Loading...</div> ) : (
        <div className="file-grid">
          {files.map((file, index) => {
            // Check file type to assign correct icon
            const info = file.isDirectory ? { icon: '📁' } : getFileInfo(file.name);
            
            return (
              <div 
                key={index} 
                className="file-tile"
                onClick={(e) => { e.stopPropagation(); handleAction('open', file); }}
                onContextMenu={(e) => {
                  e.preventDefault(); 
                  setContextMenu({ visible: true, x: e.pageX, y: e.pageY, file });
                }}
              >
                <div className="icon">{info.icon}</div>
                <div className="name">{file.name}</div>
              </div>
            );
          })}
        </div>
      )}
      
      {!loading && files.length === 0 && <div className="empty-state">This folder is empty.</div>}

     {/* Context Menu */}
      {contextMenu.visible && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={(e) => e.stopPropagation()}>
          <div className="context-menu-item" onClick={() => handleAction('open', contextMenu.file)}>
            {contextMenu.file.isDirectory ? '📂 Open Folder' : '👀 Open / View'}
          </div>
          <div className="context-menu-item" onClick={() => handleAction('download', contextMenu.file)}>⬇️ Download</div>
          <div className="context-menu-item" onClick={() => handleAction('rename', contextMenu.file)}>🏷️ Rename</div>
          <div className="context-menu-item" onClick={() => handleAction('copy', contextMenu.file)}>📄 Copy</div>
          <div className="context-menu-item danger" onClick={() => handleAction('delete', contextMenu.file)}>🗑️ Delete</div>
        </div>
      )}

      {/* Input Modal */}
      {modal.isOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>{modal.type === 'rename' ? 'Rename Item' : `Create New ${modal.type}`}</h3>
            {modal.error && <div className="error-message">{modal.error}</div>}
            <form onSubmit={handleModalSubmit}>
              <input autoFocus type="text" value={modal.input} onChange={(e) => setModal({ ...modal, input: e.target.value })} />
              <div className="modal-actions">
                <button type="button" className="action-btn btn-secondary" onClick={() => setModal({ isOpen: false })}>Cancel</button>
                <button type="submit" className="action-btn">Confirm</button>
              </div>
            </form>
          </div>
        </div>
      )}

{/* Media, PDF, Video, and Audio Viewer Modal */}
      {mediaViewer.isOpen && (
        <div className="modal-overlay" onClick={() => {
          if (mediaViewer.isBlob) URL.revokeObjectURL(mediaViewer.url);
          setMediaViewer({ isOpen: false, url: '', filename: '', type: '', isBlob: false });
        }}>
          <div 
            className={`modal-content media-preview-container ${mediaViewer.type === 'pdf' || mediaViewer.type === 'video' ? 'pdf-viewer' : ''}`} 
            onClick={e => e.stopPropagation()}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            <h3 style={{ wordBreak: 'break-all', textAlign: 'center' }}>{mediaViewer.filename}</h3>
            
            {mediaViewer.type === 'image' && <img src={mediaViewer.url} alt={mediaViewer.filename} />}
            {mediaViewer.type === 'pdf' && <iframe src={mediaViewer.url} title={mediaViewer.filename} />}
            
            {/* HTML5 Native Video Player */}
            {mediaViewer.type === 'video' && (
              <video 
                controls 
                autoPlay 
                src={mediaViewer.url} 
                style={{ width: '100%', maxHeight: '70vh', backgroundColor: '#000', borderRadius: '8px', marginBottom: '20px' }} 
              />
            )}

            {/* HTML5 Native Audio Player */}
            {mediaViewer.type === 'audio' && (
              <audio 
                controls 
                autoPlay 
                src={mediaViewer.url} 
                style={{ width: '100%', marginBottom: '20px' }} 
              />
            )}
            
            <div className="modal-actions" style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}>
              <button className="action-btn btn-secondary" onClick={() => {
                if (mediaViewer.isBlob) URL.revokeObjectURL(mediaViewer.url);
                setMediaViewer({ isOpen: false, url: '', filename: '', type: '', isBlob: false });
              }}>Close Preview</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}