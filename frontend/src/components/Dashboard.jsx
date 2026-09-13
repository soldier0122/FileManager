import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import UsersModal from './UsersModal';

const getFileInfo = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return { type: 'image', icon: '🖼️' };
  if (['mp4', 'webm', 'mkv', 'avi'].includes(ext)) return { type: 'video', icon: '🎬' };
  if (['mp3', 'wav', 'ogg'].includes(ext)) return { type: 'audio', icon: '🎵' };
  if (['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) return { type: 'archive', icon: '📦' };
  if (['pdf'].includes(ext)) return { type: 'pdf', icon: '📕' };
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'lua'].includes(ext)) return { type: 'code', icon: '📝' };
  return { type: 'text', icon: '📄' };
};

// --- Touch long-press tuning (single-threshold pattern) ---
// One timer decides everything: hold a tile for LONG_PRESS_MS and it "lifts"
// (haptic + scale/shadow). What happens next depends on motion, not more
// waiting: hold still and release -> context menu; start moving your finger
// -> the item becomes draggable and follows you until you let go.
const LONG_PRESS_MS = 500;
const PRE_PRESS_CANCEL_PX = 10; // movement before the threshold cancels the whole gesture (it's a scroll)
const DRAG_START_PX = 8;        // movement after the threshold commits to a drag
const AUTO_SCROLL_EDGE_PX = 48; // how close to the list's top/bottom edge triggers auto-scroll
const AUTO_SCROLL_SPEED = 10;   // px per animation frame while auto-scrolling

export default function Dashboard({ onLogout }) {
  const [uploadStats, setUploadStats] = useState({ progress: 0, eta: '', speed: '' });
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState(() => sessionStorage.getItem('vps_currentPath') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  const [editorState, setEditorState] = useState({ isOpen: false, filePath: '', content: '', isSaving: false });
  const [mediaViewer, setMediaViewer] = useState({ isOpen: false, url: '', filename: '', type: '', isBlob: false });
  const [modal, setModal] = useState({ isOpen: false, type: '', input: '', error: '', targetPath: '' });
  const [clipboard, setClipboard] = useState(null);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, file: null });
  const [usersModalOpen, setUsersModalOpen] = useState(false);

  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null);

  // Touch-only state. touchGesture drives the tile's visual state:
  // { path, mode: 'pressed' | 'dragging' } while a long-press is in
  // progress, or null otherwise. dragGhost is the floating preview that
  // follows the finger once a drag has actually started.
  const [touchGesture, setTouchGesture] = useState(null);
  const [dragGhost, setDragGhost] = useState(null);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const explorerBodyRef = useRef(null);

  // Bookkeeping for the in-progress touch gesture, kept in a ref (not state)
  // so timers and touchmove handlers can read/mutate it without waiting on
  // renders: { startX, startY, file, info, rect, pressed, dragging, timer }.
  const touchDataRef = useRef(null);
  // When a long-press already opened the menu or started a drag, the
  // browser's trailing synthetic "click" on release must be swallowed so we
  // don't also open the file/folder.
  const suppressClickRef = useRef(false);
  const autoScrollRAFRef = useRef(null);
  const autoScrollDirRef = useRef(0);

  useEffect(() => {
    sessionStorage.setItem('vps_currentPath', currentPath);
    fetchFiles(currentPath);
  }, [currentPath]);

  useEffect(() => {
    const handleClick = () => setContextMenu({ visible: false, x: 0, y: 0, file: null });
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Clean up any pending timers/animation frames if the component unmounts mid-gesture.
  useEffect(() => {
    return () => {
      if (touchDataRef.current) clearTimeout(touchDataRef.current.timer);
      if (autoScrollRAFRef.current) cancelAnimationFrame(autoScrollRAFRef.current);
    };
  }, []);

  const fetchFiles = async (path) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('vps_token');
      const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (response.status === 401 || response.status === 403) return onLogout();
      const rawText = await response.text();
      let data = {};
      if (rawText) {
        try { data = JSON.parse(rawText); } catch { throw new Error('Unexpected server response'); }
      }
      if (!response.ok) throw new Error(data.error || 'Failed to fetch files');
      setFiles(data.files || []);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const navigateUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  const parentPath = currentPath ? currentPath.split('/').slice(0, -1).join('/') : null;

  // --- Upload Logic ---
  // Sends a batch of { file, relativePath } entries. relativePath preserves
  // any folder structure (e.g. "notes/week1/lecture.pdf") so the backend can
  // recreate it under the current directory instead of flattening everything.
const performUpload = async (entries) => {
    if (!entries || entries.length === 0) return;
    setIsUploading(true);
    setUploadStats({ progress: 0, eta: 'Calculating...', speed: '' });

    const formData = new FormData();
    formData.append('currentPath', currentPath);
    const relativePaths = [];
    entries.forEach(({ file, relativePath }) => {
      formData.append('files', file);
      relativePaths.push(relativePath || file.name);
    });
    formData.append('relativePaths', JSON.stringify(relativePaths));

    const token = localStorage.getItem('vps_token');
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload', true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      // Do NOT set Content-Type; XHR handles the FormData boundary automatically

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          const timeElapsed = (Date.now() - startTime) / 1000; // in seconds
          
          let eta = 'Calculating...';
          let speed = '';

          // Wait half a second before calculating to avoid infinity errors
          if (timeElapsed > 0.5 && event.loaded > 0) {
            const speedBps = event.loaded / timeElapsed;
            const bytesRemaining = event.total - event.loaded;
            const secondsRemaining = Math.round(bytesRemaining / speedBps);
            
            // Format ETA
            if (secondsRemaining > 60) {
              eta = `${Math.floor(secondsRemaining / 60)}m ${secondsRemaining % 60}s left`;
            } else {
              eta = `${secondsRemaining}s left`;
            }

            // Format Speed
            if (speedBps > 1024 * 1024) speed = (speedBps / (1024 * 1024)).toFixed(1) + ' MB/s';
            else speed = (speedBps / 1024).toFixed(1) + ' KB/s';
          }

          setUploadStats({ progress, eta, speed });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          fetchFiles(currentPath);
          resolve();
        } else {
          let errMessage = 'Failed to upload';
          try { errMessage = JSON.parse(xhr.responseText).error || errMessage; } catch (e) {}
          reject(new Error(errMessage));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      
      xhr.onloadend = () => {
        setIsUploading(false);
        setUploadStats({ progress: 0, eta: '', speed: '' });
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (folderInputRef.current) folderInputRef.current.value = '';
      };

      xhr.send(formData);
    }).catch(err => alert(err.message));
  };

  // Used by the plain file <input> and the folder <input webkitdirectory>.
  // When a folder is picked via the input, the browser fills in
  // file.webkitRelativePath (e.g. "MyFolder/notes.txt") automatically.
  const uploadFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const entries = Array.from(fileList).map(file => ({
      file,
      relativePath: file.webkitRelativePath || file.name
    }));
    return performUpload(entries);
  };

  // Recursively walks a DataTransfer's items to support dragging entire
  // folders in from the OS. Falls back to the flat file list for browsers
  // without the (widely supported) FileSystem Entry API.
  const collectEntriesFromDataTransfer = async (dataTransfer) => {
    const items = dataTransfer.items;
    if (!items || !items.length || !items[0].webkitGetAsEntry) {
      return Array.from(dataTransfer.files).map(file => ({ file, relativePath: file.name }));
    }

    const topEntries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (entry) topEntries.push(entry);
    }

    if (topEntries.length === 0) {
      return Array.from(dataTransfer.files).map(file => ({ file, relativePath: file.name }));
    }

    const entries = [];

    const readDirectory = (dirEntry) => new Promise((resolve, reject) => {
      const reader = dirEntry.createReader();
      let all = [];
      const readBatch = () => {
        reader.readEntries((batch) => {
          if (!batch.length) { resolve(all); return; }
          all = all.concat(batch);
          readBatch();
        }, reject);
      };
      readBatch();
    });

    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        entries.push({ file, relativePath: prefix + entry.name });
      } else if (entry.isDirectory) {
        const children = await readDirectory(entry);
        for (const child of children) {
          await walk(child, `${prefix}${entry.name}/`);
        }
      }
    };

    for (const entry of topEntries) {
      await walk(entry, '');
    }

    return entries;
  };

  // Shared by both mouse drag-and-drop and touch long-press-to-move: moves
  // sourcePath into destinationDir and refreshes the listing.
  const performMove = async (sourcePath, destinationDir) => {
    try {
      const token = localStorage.getItem('vps_token');
      const res = await fetch('/api/files/move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ sourcePath, destinationDir: destinationDir || '' })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to move');
      fetchFiles(currentPath);
    } catch (err) { alert(err.message); }
  };

  // --- Drag and Drop Handlers (mouse / desktop OS drag) ---
  const handleDragStart = (e, file) => {
    e.dataTransfer.setData('text/plain', file.path); 
    setDraggedItem(file.path);
  };

  const handleDragOver = (e, targetPath) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if we are dragging external OS files
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      setDragOverTarget(targetPath || 'GRID');
    } else {
      e.dataTransfer.dropEffect = 'move';
      if (draggedItem && draggedItem !== targetPath) setDragOverTarget(targetPath);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
  };

  const handleDrop = async (e, destinationDir) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);

    // 1. Handle External File Drop (from Windows/Mac), including whole folders
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const entries = await collectEntriesFromDataTransfer(e.dataTransfer);
      await performUpload(entries);
      return;
    }

    // 2. Handle Internal File Move (from inside the app)
    const sourcePath = e.dataTransfer.getData('text/plain') || draggedItem;
    if (!sourcePath || sourcePath === destinationDir) {
      setDraggedItem(null);
      return; 
    }

    await performMove(sourcePath, destinationDir);
    setDraggedItem(null);
  };

  // --- Touch auto-scroll while dragging near the list's edges ---
  const updateAutoScroll = (clientY) => {
    const container = explorerBodyRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    let dir = 0;
    if (clientY < rect.top + AUTO_SCROLL_EDGE_PX) dir = -1;
    else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) dir = 1;
    autoScrollDirRef.current = dir;

    if (dir !== 0 && !autoScrollRAFRef.current) {
      const step = () => {
        const c = explorerBodyRef.current;
        if (!c || autoScrollDirRef.current === 0) { autoScrollRAFRef.current = null; return; }
        c.scrollTop += AUTO_SCROLL_SPEED * autoScrollDirRef.current;
        autoScrollRAFRef.current = requestAnimationFrame(step);
      };
      autoScrollRAFRef.current = requestAnimationFrame(step);
    } else if (dir === 0 && autoScrollRAFRef.current) {
      cancelAnimationFrame(autoScrollRAFRef.current);
      autoScrollRAFRef.current = null;
    }
  };

  const stopAutoScroll = () => {
    autoScrollDirRef.current = 0;
    if (autoScrollRAFRef.current) {
      cancelAnimationFrame(autoScrollRAFRef.current);
      autoScrollRAFRef.current = null;
    }
  };

  // --- Touch Handlers (single-threshold long-press: hold-still -> menu, hold-and-move -> drag) ---
  const handleTouchStart = (e, file, info) => {
    if (e.touches.length !== 1) return; // ignore multi-touch (pinch/scroll gestures)

    const touch = e.touches[0];
    suppressClickRef.current = false;
    const rect = e.currentTarget.getBoundingClientRect();

    const data = {
      startX: touch.clientX,
      startY: touch.clientY,
      file,
      info,
      rect,
      pressed: false,
      dragging: false,
      timer: null,
    };
    touchDataRef.current = data;

    data.timer = setTimeout(() => {
      if (touchDataRef.current !== data) return;
      data.pressed = true;
      if (navigator.vibrate) navigator.vibrate(10);
      setTouchGesture({ path: file.path, mode: 'pressed' });
    }, LONG_PRESS_MS);
  };

  const handleTouchMove = (e) => {
    const data = touchDataRef.current;
    if (!data) return;
    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - data.startX;
    const dy = touch.clientY - data.startY;

    if (!data.pressed) {
      // Still waiting to see if this is a hold; moving early means it's a scroll.
      if (Math.abs(dx) > PRE_PRESS_CANCEL_PX || Math.abs(dy) > PRE_PRESS_CANCEL_PX) {
        clearTimeout(data.timer);
        touchDataRef.current = null;
      }
      return;
    }

    if (!data.dragging) {
      // Pressed and holding — decide based on whether the finger starts moving.
      if (Math.abs(dx) > DRAG_START_PX || Math.abs(dy) > DRAG_START_PX) {
        data.dragging = true;
        suppressClickRef.current = true;
        if (navigator.vibrate) navigator.vibrate([12, 30, 12]);
        setDraggedItem(data.file.path);
        setTouchGesture({ path: data.file.path, mode: 'dragging' });
        setDragGhost({ x: touch.clientX, y: touch.clientY, icon: data.info.icon, name: data.file.name });
      } else {
        return; // holding roughly still, no decision yet
      }
    }

    // Actively dragging: stop the page scrolling underneath the finger,
    // move the ghost preview, and highlight whatever drop target it's over.
    if (e.cancelable) e.preventDefault();
    setDragGhost(g => (g ? { ...g, x: touch.clientX, y: touch.clientY } : g));
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const dropEl = el ? el.closest('[data-drop-path]') : null;
    const target = dropEl ? dropEl.getAttribute('data-drop-path') : null;
    setDragOverTarget(target !== null && target !== data.file.path ? target : null);
    updateAutoScroll(touch.clientY);
  };

  const handleTouchEnd = (e) => {
    const data = touchDataRef.current;
    touchDataRef.current = null;
    stopAutoScroll();
    if (!data) return;
    clearTimeout(data.timer);

    if (data.dragging) {
      if (e.cancelable) e.preventDefault();
      const touch = e.changedTouches[0];
      const el = touch ? document.elementFromPoint(touch.clientX, touch.clientY) : null;
      const dropEl = el ? el.closest('[data-drop-path]') : null;
      const destinationDir = dropEl ? dropEl.getAttribute('data-drop-path') : null;

      suppressClickRef.current = true;
      setDraggedItem(null);
      setDragOverTarget(null);
      setTouchGesture(null);
      setDragGhost(null);

      if (destinationDir !== null && destinationDir !== data.file.path) {
        performMove(data.file.path, destinationDir);
      }
      return;
    }

    if (data.pressed) {
      // Held still, then released -> open the context menu anchored near the tile
      // (not the raw fingertip, so the menu doesn't end up hidden under the thumb).
      suppressClickRef.current = true;
      setTouchGesture(null);

      const estimatedMenuWidth = 180;
      const estimatedMenuHeight = 210;
      let menuX = data.rect.left + data.rect.width / 2 - estimatedMenuWidth / 2;
      menuX = Math.min(Math.max(8, menuX), window.innerWidth - estimatedMenuWidth - 8);

      let menuY = data.rect.bottom + 8;
      if (menuY + estimatedMenuHeight > window.innerHeight) {
        menuY = Math.max(8, data.rect.top - estimatedMenuHeight - 8);
      }

      setContextMenu({ visible: true, x: menuX, y: menuY, file: data.file });
    }
    // else: quick tap — do nothing extra, the trailing click event opens the item.
  };

  const handleTouchCancel = () => {
    const data = touchDataRef.current;
    touchDataRef.current = null;
    stopAutoScroll();
    if (data) clearTimeout(data.timer);
    setDraggedItem(null);
    setDragOverTarget(null);
    setTouchGesture(null);
    setDragGhost(null);
  };

  // --- API & UI Actions ---
  const handleModalSubmit = async (e) => {
    e.preventDefault();
    setModal(prev => ({ ...prev, error: '' }));
    if (!modal.input.trim()) return setModal(prev => ({ ...prev, error: 'Name cannot be empty' }));

    try {
      const token = localStorage.getItem('vps_token');
      let endpoint, body, method = 'POST';

      if (modal.type === 'rename') {
        endpoint = '/api/files/rename'; method = 'PUT'; body = { oldPath: modal.targetPath, newName: modal.input };
      } else {
        endpoint = modal.type === 'folder' ? '/api/files/folder' : '/api/files/text';
        body = modal.type === 'folder' ? { currentPath, folderName: modal.input } : { currentPath, fileName: modal.input };
      }

      const res = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(body) });
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
      } else if (fileInfo.type === 'video' || fileInfo.type === 'audio') {
        const url = `/api/files/download?path=${encodeURIComponent(file.path)}&token=${token}`;
        setMediaViewer({ isOpen: true, url, filename: file.name, type: fileInfo.type, isBlob: false });
      } else if (fileInfo.type === 'code' || fileInfo.type === 'text') {
        openFile(file.path);
      } else alert(`Cannot preview ${fileInfo.type} files yet.`);
    } 
    else if (action === 'download') {
      const url = `/api/files/export?path=${encodeURIComponent(file.path)}&token=${token}`;
      const a = document.createElement('a'); a.style.display = 'none'; a.href = url;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
    } catch (err) { alert(err.message); } finally { setEditorState(prev => ({ ...prev, isSaving: false })); }
  };

  if (editorState.isOpen) {
    const lang = editorState.filePath.split('.').pop().toLowerCase();
    const map = { js: 'javascript', json: 'json', html: 'html', css: 'css', py: 'python', lua: 'lua' };
    return (
      <div className="dashboard-container editor-view">
        <div className="controls-bar" style={{ marginBottom: '10px' }}>
          <span>Editing: {editorState.filePath}</span>
          <div className="action-buttons">
            <button className="action-btn btn-secondary" onClick={() => setEditorState({ isOpen: false })}>Close</button>
            <button className="action-btn" onClick={saveFile} disabled={editorState.isSaving}>Save</button>
          </div>
        </div>
        <div className="editor-shell">
          <Editor height="100%" theme="vs-dark" language={map[lang] || 'plaintext'} value={editorState.content} onChange={v => setEditorState(prev => ({ ...prev, content: v }))} options={{ minimap: { enabled: false } }} />
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>File Explorer</h2>
        <div className="action-buttons">
          <button onClick={() => setUsersModalOpen(true)} className="action-btn" style={{ backgroundColor: '#0056b3' }}>👥 Users</button>
          <button onClick={onLogout} className="logout-btn">Log Out</button>
        </div>
      </div>
      
      <div className="controls-bar">
        <div className="breadcrumbs">
          <button 
            className={`back-btn ${dragOverTarget === 'UP_LEVEL' ? 'drag-over' : ''}`}
            onClick={navigateUp} 
            disabled={!currentPath}
            data-drop-path={currentPath ? parentPath : undefined}
            onDragOver={currentPath ? (e) => handleDragOver(e, 'UP_LEVEL') : null}
            onDragLeave={currentPath ? handleDragLeave : null}
            onDrop={currentPath ? (e) => handleDrop(e, parentPath) : null}
          >
            &#8592; Up
          </button>
          
          <span 
            className={`breadcrumb-segment ${dragOverTarget === 'ROOT' ? 'drag-over' : ''}`}
            data-drop-path=""
            onClick={() => setCurrentPath('')}
            onDragOver={(e) => handleDragOver(e, 'ROOT')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, '')}
          >
            Root
          </span>

          {currentPath && currentPath.split('/').map((part, index, arr) => {
            const targetPath = arr.slice(0, index + 1).join('/');
            return (
              <span key={targetPath}>
                {' / '}
                <span 
                  className={`breadcrumb-segment ${dragOverTarget === targetPath ? 'drag-over' : ''}`}
                  data-drop-path={targetPath}
                  onClick={() => setCurrentPath(targetPath)}
                  onDragOver={(e) => handleDragOver(e, targetPath)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, targetPath)}
                >
                  {part}
                </span>
              </span>
            );
          })}
        </div>
        <div className="action-buttons">
          {clipboard && <button className="action-btn" style={{ backgroundColor: '#2e7d32' }} onClick={handlePaste}>📋 Paste Here</button>}
          
          {/* Hidden File Input & Upload Button */}
          <input 
            type="file" 
            multiple 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={(e) => uploadFiles(e.target.files)} 
          />
          <button className="action-btn" style={{ backgroundColor: '#0056b3' }} onClick={() => fileInputRef.current.click()} disabled={isUploading}>
            {isUploading ? 'Uploading...' : '⬆️ Upload'}
          </button>

          {/* Hidden Folder Input & Upload Folder Button. webkitdirectory is
              a de-facto standard supported by all major browsers; it makes
              the OS picker choose a folder and populates each File's
              webkitRelativePath so the backend can rebuild the structure. */}
          <input 
            type="file" 
            webkitdirectory=""
            directory=""
            mozdirectory=""
            multiple 
            ref={folderInputRef} 
            style={{ display: 'none' }} 
            onChange={(e) => uploadFiles(e.target.files)} 
          />
          <button className="action-btn" style={{ backgroundColor: '#0056b3' }} onClick={() => folderInputRef.current.click()} disabled={isUploading}>
            {isUploading ? 'Uploading...' : '📁 Upload Folder'}
          </button>
          
          <button className="action-btn" onClick={() => setModal({ isOpen: true, type: 'folder', input: '' })}>+ Folder</button>
          <button className="action-btn" onClick={() => setModal({ isOpen: true, type: 'text', input: '' })}>+ File</button>
        </div>
      </div>

      {isUploading && (
              <div style={{ padding: '14px', backgroundColor: 'var(--surface-alt)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <span style={{ fontWeight: '500', color: 'var(--text-primary)' }}>Uploading... {uploadStats.progress}%</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{uploadStats.speed} &nbsp;&bull;&nbsp; {uploadStats.eta}</span>
                </div>
                <div style={{ width: '100%', backgroundColor: 'var(--bg-elevated)', borderRadius: '4px', overflow: 'hidden', height: '6px' }}>
                  <div style={{ width: `${uploadStats.progress}%`, backgroundColor: 'var(--accent)', height: '100%', transition: 'width 0.2s linear' }} />
                </div>
              </div>
            )}

      <div className="explorer-body" ref={explorerBodyRef}>
        {error && <div className="error-message">{error}</div>}

        {loading ? ( <div className="loading-state">Loading...</div> ) : (
          <div 
            className={`file-grid ${dragOverTarget === 'GRID' ? 'drag-over' : ''}`}
            data-drop-path={currentPath}
            onDragOver={(e) => handleDragOver(e, null)} // Pass null so it defaults to 'GRID' logic
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, currentPath)} // Drop OS files into the current open folder
          >
            {files.map((file, index) => {
              const info = file.isDirectory ? { icon: '📁' } : getFileInfo(file.name);
              const isDragOver = dragOverTarget === file.path;
              const isTouchPressed = touchGesture && touchGesture.path === file.path && touchGesture.mode === 'pressed';
              const isTouchDragging = touchGesture && touchGesture.path === file.path && touchGesture.mode === 'dragging';
              
              return (
                <div 
                  key={index} 
                  className={`file-tile ${file.isDirectory ? 'is-folder' : ''} ${isDragOver ? 'drag-over' : ''} ${isTouchPressed ? 'touch-pressed' : ''} ${isTouchDragging ? 'touch-dragging' : ''}`}
                  draggable={true}
                  data-drop-path={file.isDirectory ? file.path : undefined}
                  onDragStart={(e) => handleDragStart(e, file)}
                  onDragOver={file.isDirectory ? (e) => handleDragOver(e, file.path) : null}
                  onDragLeave={file.isDirectory ? handleDragLeave : null}
                  onDrop={file.isDirectory ? (e) => handleDrop(e, file.path) : null}
                  onTouchStart={(e) => handleTouchStart(e, file, info)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchCancel}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                    handleAction('open', file);
                  }}
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
        
        {!loading && files.length === 0 && (
          <div 
            className={`empty-state ${dragOverTarget === 'GRID' ? 'drag-over' : ''}`}
            data-drop-path={currentPath}
            onDragOver={(e) => handleDragOver(e, null)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, currentPath)}
          >
            This folder is empty. Drag files or folders here to upload.
          </div>
        )}
      </div>

      {contextMenu.visible && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={(e) => e.stopPropagation()}>
          <div className="context-menu-item" onClick={() => handleAction('open', contextMenu.file)}>{contextMenu.file.isDirectory ? '📂 Open Folder' : '👀 Open / View'}</div>
          <div className="context-menu-item" onClick={() => handleAction('download', contextMenu.file)}>⬇️ Download</div>
          <div className="context-menu-item" onClick={() => handleAction('rename', contextMenu.file)}>🏷️ Rename</div>
          <div className="context-menu-item" onClick={() => handleAction('copy', contextMenu.file)}>📄 Copy</div>
          <div className="context-menu-item danger" onClick={() => handleAction('delete', contextMenu.file)}>🗑️ Delete</div>
        </div>
      )}

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

      {mediaViewer.isOpen && (
        <div className="modal-overlay" onClick={() => {
          if (mediaViewer.isBlob) URL.revokeObjectURL(mediaViewer.url);
          setMediaViewer({ isOpen: false, url: '', filename: '', type: '', isBlob: false });
        }}>
          <div className={`modal-content media-preview-container ${mediaViewer.type === 'pdf' || mediaViewer.type === 'video' ? 'pdf-viewer' : ''}`} onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ wordBreak: 'break-all', textAlign: 'center' }}>{mediaViewer.filename}</h3>
            {mediaViewer.type === 'image' && <img src={mediaViewer.url} alt={mediaViewer.filename} />}
            {mediaViewer.type === 'pdf' && <iframe src={mediaViewer.url} title={mediaViewer.filename} />}
            {mediaViewer.type === 'video' && <video controls src={mediaViewer.url} style={{ width: '100%', maxHeight: '70vh', backgroundColor: '#000', borderRadius: '8px', marginBottom: '20px' }} />}
            {mediaViewer.type === 'audio' && <audio controls src={mediaViewer.url} style={{ width: '100%', marginBottom: '20px' }} />}
            <div className="modal-actions" style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}>
              <button className="action-btn btn-secondary" onClick={() => {
                if (mediaViewer.isBlob) URL.revokeObjectURL(mediaViewer.url);
                setMediaViewer({ isOpen: false, url: '', filename: '', type: '', isBlob: false });
              }}>Close Preview</button>
            </div>
          </div>
        </div>
      )}

      {dragGhost && (
        <div className="touch-drag-ghost" style={{ left: dragGhost.x, top: dragGhost.y }}>
          <div className="icon">{dragGhost.icon}</div>
          <div className="name">{dragGhost.name}</div>
        </div>
      )}

      {usersModalOpen && (
        <UsersModal onClose={() => setUsersModalOpen(false)} onLogout={onLogout} />
      )}
    </div>
  );
}
