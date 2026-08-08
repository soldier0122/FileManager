import { useState, useEffect } from 'react';

export default function Dashboard({ onLogout }) {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [rootPath, setRootPath] = useState('');

  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('vps_token');
      
      const response = await fetch('/api/files', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      // If the token is invalid or expired, force a logout
      if (response.status === 401 || response.status === 403) {
        onLogout();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch files');
      }

      setFiles(data.files);
      setRootPath(data.rootPath);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>File Explorer</h2>
        <button onClick={onLogout} className="logout-btn">Log Out</button>
      </div>
      
      <div className="path-display">
        <span className="path-label">Secure Storage Root</span>
        <code className="path-value">{rootPath}</code>
      </div>

      {error && <div className="error-message">{error}</div>}
      
      {loading ? (
        <div className="loading-state">Loading files...</div>
      ) : (
        <div className="file-list">
          {files.length === 0 ? (
            <div className="empty-state">This folder is empty.</div>
          ) : (
            files.map((file, index) => (
              <div key={index} className="file-item">
                <span className="file-icon">
                  {file.isDirectory ? '📁' : '📄'}
                </span>
                <span className="file-name">{file.name}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}