import { useState, useEffect } from 'react';

export default function Dashboard({ onLogout }) {
  const [files, setFiles] = useState([]);
  // Initialize from sessionStorage to survive page reloads and Vite HMR
  const [currentPath, setCurrentPath] = useState(() => sessionStorage.getItem('vps_currentPath') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal State
  const [modal, setModal] = useState({ isOpen: false, type: '', input: '', error: '' });

  useEffect(() => {
    // Save the path to browser storage every time it changes
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

  const openModal = (type) => {
    setModal({ isOpen: true, type, input: '', error: '' });
  };

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    setModal(prev => ({ ...prev, error: '' }));

    if (!modal.input.trim()) {
      setModal(prev => ({ ...prev, error: 'Name cannot be empty' }));
      return;
    }

    try {
      const token = localStorage.getItem('vps_token');
      const endpoint = modal.type === 'folder' ? '/api/files/folder' : '/api/files/text';
      const body = modal.type === 'folder' 
        ? { currentPath, folderName: modal.input } 
        : { currentPath, fileName: modal.input };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      const rawText = await res.text();
      let data = {};

      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(rawText.slice(0, 200) || `Failed to create ${modal.type}`);
        }
      }

      if (!res.ok) {
        throw new Error(data.error || `Failed to create ${modal.type}`);
      }

      setModal({ isOpen: false, type: '', input: '', error: '' });
      fetchFiles(currentPath);
    } catch (err) {
      setModal(prev => ({ ...prev, error: err.message }));
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>File Explorer</h2>
        <button onClick={onLogout} className="logout-btn">Log Out</button>
      </div>
      
      <div className="controls-bar">
        <div className="breadcrumbs">
          <button className="back-btn" onClick={navigateUp} disabled={!currentPath}>
            &#8592; Up
          </button>
          <span>Root {currentPath ? `/ ${currentPath}` : ''}</span>
        </div>
        <div className="action-buttons">
          <button className="action-btn" onClick={() => openModal('folder')}>+ Folder</button>
          <button className="action-btn" onClick={() => openModal('text')}>+ Text File</button>
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
              onClick={() => {
                if (file.isDirectory) setCurrentPath(file.path);
              }}
              onDoubleClick={() => {
                if (file.isDirectory) setCurrentPath(file.path);
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

      {/* Custom Built-in Modal */}
      {modal.isOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Create {modal.type === 'folder' ? 'New Folder' : 'New Text File'}</h3>
            {modal.error && <div className="error-message">{modal.error}</div>}
            
            <form onSubmit={handleModalSubmit}>
              <input
                autoFocus
                type="text"
                placeholder={`Enter ${modal.type} name...`}
                value={modal.input}
                onChange={(e) => setModal({ ...modal, input: e.target.value })}
              />
              <div className="modal-actions">
                <button 
                  type="button" 
                  className="action-btn btn-secondary" 
                  onClick={() => setModal({ isOpen: false, type: '', input: '', error: '' })}
                >
                  Cancel
                </button>
                <button type="submit" className="action-btn">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}