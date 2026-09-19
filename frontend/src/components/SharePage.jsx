import { useEffect, useState } from 'react';
import { getFileInfo, formatBytes } from '../utils/fileInfo';

// Public page opened from a share link (/s/<token>). No login involved: it
// shows the item's icon and name plus a download button.
export default function SharePage({ token }) {
  const [state, setState] = useState({ status: 'loading', item: null });

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 404) return { status: 'missing', item: null };
        if (!res.ok) throw new Error('Request failed');
        return { status: 'ready', item: await res.json() };
      })
      .catch(() => ({ status: 'error', item: null }))
      .then((next) => {
        if (!cancelled) setState(next);
      });

    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (state.item) document.title = `${state.item.name} · File Manager`;
  }, [state.item]);

  if (state.status === 'loading') {
    return (
      <div className="status-screen">
        <div className="status-card">
          <span className="brand-mark" aria-hidden="true">🔗</span>
          <p className="status-text">Loading…</p>
        </div>
      </div>
    );
  }

  if (state.status !== 'ready') {
    const missing = state.status === 'missing';
    return (
      <div className="status-screen">
        <div className="status-card status-card-error">
          <span className="brand-mark" aria-hidden="true">{missing ? '🔗' : '⚠️'}</span>
          <p className="status-text">
            {missing ? 'This link is invalid or has been removed.' : "Couldn't reach the server. Try again in a moment."}
          </p>
        </div>
      </div>
    );
  }

  const { name, isDirectory, size } = state.item;
  const icon = isDirectory ? '📁' : getFileInfo(name).icon;

  return (
    <div className="status-screen">
      <div className="app-container share-card">
        <div className="share-icon" aria-hidden="true">{icon}</div>
        <h2 className="share-name">{name}</h2>
        <p className="share-meta">
          {isDirectory ? 'Folder · downloads as a .zip' : formatBytes(size)}
        </p>
        <a className="share-download-btn" href={`/api/share/${encodeURIComponent(token)}/download`} download>
          ⬇️ Download{isDirectory ? ' folder' : ''}
        </a>
      </div>
    </div>
  );
}
