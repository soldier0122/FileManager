import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';

export default function Dashboard({ onLogout }) {
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState(() => sessionStorage.getItem('vps_currentPath') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Editor State
  const [editorState, setEditorState] = useState({ isOpen: false, filePath: '', content: '', isSaving: false });

  // Modal State
  const [modal, setModal] = useState({ isOpen: false, type: '', input: '', error: '' });

  useEffect(() => {
    sessionStorage.setItem('vps_currentPath', currentPath);
    fetchFiles(currentPath);
  }, [currentPath]);

  const fetchFiles = async (path) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('vps_token');
      const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.status === 401 || response.status === 403) {
        onLogout();
        return;
      }

      const rawText = await response.text();
      let data = {};

      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(rawText.slice(0, 200) || 'Unexpected server response');
        }
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

  // --- Modal Logic ---
  const openModal = (type) => setModal({ isOpen: true, type, input: '', error: '' });

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    setModal(prev => ({ ...prev, error: '' }));
    if (!modal.input.trim()) return setModal(prev => ({ ...prev, error: 'Name cannot be empty' }));

    try {
      const token = localStorage.getItem('vps_token');
      const endpoint = modal.type === 'folder' ? '/api/files/folder' : '/api/files/text';
      const body = modal.type === 'folder' 
        ? { currentPath, folderName: modal.input } 
        : { currentPath, fileName: modal.input };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
      });

      if (!res.ok) throw new Error((await res.json()).error || `Failed to create ${modal.type}`);

      setModal({ isOpen: false, type: '', input: '', error: '' });
      fetchFiles(currentPath);
    } catch (err) {
      setModal(prev => ({ ...prev, error: err.message }));
    }
  };

  // --- Editor Logic ---
  const openFile = async (filePath) => {
    try {
      const token = localStorage.getItem('vps_token');
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const rawText = await res.text();
      let data = {};

      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(rawText.slice(0, 200) || 'Failed to read file');
        }
      }

      if (!res.ok) throw new Error(data.error || 'Failed to read file');

      setEditorState({ isOpen: true, filePath, content: data.content || '', isSaving: false });
    } catch (err) {
      setError(err.message);
    }
  };

  const saveFile = async () => {
    setEditorState(prev => ({ ...prev, isSaving: true }));
    try {
      const token = localStorage.getItem('vps_token');
      const res = await fetch('/api/files/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ filePath: editorState.filePath, content: editorState.content })
      });

      const rawText = await res.text();
      let data = {};

      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(rawText.slice(0, 200) || 'Failed to save file');
        }
      }

      if (!res.ok) throw new Error(data.error || 'Failed to save file');
      alert('File saved successfully!');
    } catch (err) {
      alert(err.message);
    } finally {
      setEditorState(prev => ({ ...prev, isSaving: false }));
    }
  };

  // If the editor is open, render the editor UI instead of the file grid
  if (editorState.isOpen) {
    // Basic language detection based on extension
    const extension = editorState.filePath.split('.').pop().toLowerCase();
    const languageMap = { js: 'javascript', json: 'json', html: 'html', css: 'css', py: 'python', r: 'r', sql: 'sql', java: 'java' };
    const language = languageMap[extension] || 'plaintext';

    return (
      <div className="dashboard-container" style={{ display: 'flex', flexDirection: 'column', height: '80vh' }}>
        <div className="controls-bar" style={{ marginBottom: '10px' }}>
          <div className="breadcrumbs">
            <span>Editing: {editorState.filePath}</span>
          </div>
          <div className="action-buttons">
            <button className="action-btn btn-secondary" onClick={() => setEditorState({ isOpen: false })}>Close</button>
            <button className="action-btn" onClick={saveFile} disabled={editorState.isSaving}>
              {editorState.isSaving ? 'Saving...' : 'Save File'}
            </button>
          </div>
        </div>
        <div style={{ flexGrow: 1, border: '1px solid #333', borderRadius: '8px', overflow: 'hidden' }}>
          <Editor
            height="100%"
            theme="vs-dark"
            language={language}
            value={editorState.content}
            onChange={(value) => setEditorState(prev => ({ ...prev, content: value }))}
            options={{ minimap: { enabled: false }, fontSize: 14 }}
          />
        </div>
      </div>
    );
  }

  // Otherwise, render the standard file grid
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
          <button className="action-btn" onClick={() => openModal('folder')}>+ Folder</button>
          <button className="action-btn" onClick={() => openModal('text')}>+ File</button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      
      {loading ? (
        <div className="loading-state">Loading...</div>
      ) : (
        <div className="file-grid">
          {files.map((file, index) => (
            <div 
            key={index} 
            className="file-tile"
            // Use onClick for both now, but check if it's a folder or file
            onClick={(e) => {
                e.stopPropagation(); // Prevents bubbling issues
                if (file.isDirectory) {
                setCurrentPath(file.path);
                } else {
                openFile(file.path);
                }
            }}
            >
              <div className="icon">{file.isDirectory ? '📁' : '📄'}</div>
              <div className="name">{file.name}</div>
            </div>
          ))}
        </div>
      )}
      
      {!loading && files.length === 0 && (
        <div className="empty-state">This folder is empty.</div>
      )}

      {modal.isOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Create {modal.type === 'folder' ? 'New Folder' : 'New File'}</h3>
            {modal.error && <div className="error-message">{modal.error}</div>}
            <form onSubmit={handleModalSubmit}>
              <input
                autoFocus
                type="text"
                placeholder={`Enter ${modal.type} name (e.g., script.py)`}
                value={modal.input}
                onChange={(e) => setModal({ ...modal, input: e.target.value })}
              />
              <div className="modal-actions">
                <button type="button" className="action-btn btn-secondary" onClick={() => setModal({ isOpen: false })}>Cancel</button>
                <button type="submit" className="action-btn">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}