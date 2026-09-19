import { useEffect, useRef, useState } from 'react';

// Opens for one file/folder: creates (or fetches the existing) public link,
// lets you copy it, and lets you switch sharing off again.
export default function ShareModal({ file, onClose, onLogout }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [stopping, setStopping] = useState(false);
  const inputRef = useRef(null);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('vps_token')}`
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/share', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ filePath: file.path })
        });
        if (res.status === 401 || res.status === 403) {
          // 403 also means "path out of bounds", but the token is the far likelier cause here.
          if (!cancelled) onLogout();
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to create share link');
        if (!cancelled) setUrl(data.url);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  const copyLink = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // navigator.clipboard only exists on https/localhost; fall back to the
      // old select-and-copy path so it also works over plain http.
      try {
        inputRef.current?.select();
        ok = document.execCommand('copy');
      } catch { /* the link stays selected so it can still be copied by hand */ }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const stopSharing = async () => {
    setStopping(true);
    setError('');
    try {
      const res = await fetch('/api/share', {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify({ filePath: file.path })
      });
      if (res.status === 401 || res.status === 403) return onLogout();
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 404) throw new Error(data.error || 'Failed to stop sharing');
      onClose();
    } catch (err) {
      setError(err.message);
      setStopping(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content share-modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>🔗 Share “{file.name}”</h3>

        {error && <div className="error-message">{error}</div>}

        {loading && <div className="loading-state" style={{ padding: '24px' }}>Creating link…</div>}

        {!loading && url && (
          <>
            <p style={{ marginTop: '-8px', marginBottom: '14px' }}>
              Anyone with this link can download {file.isDirectory ? 'this folder as a .zip' : 'this file'}, no login needed.
            </p>
            <div className="share-link-row">
              <input
                ref={inputRef}
                type="text"
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
                aria-label="Share link"
              />
              <button type="button" className="action-btn" onClick={copyLink}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </>
        )}

        <div className="modal-actions">
          {url && (
            <button type="button" className="action-btn share-stop-btn" onClick={stopSharing} disabled={stopping}>
              {stopping ? 'Stopping…' : 'Stop sharing'}
            </button>
          )}
          <button type="button" className="action-btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
