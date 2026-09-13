import { useEffect, useState } from 'react';

export default function UsersModal({ onClose, onLogout }) {
  const [users, setUsers] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  const authHeaders = () => ({
    'Authorization': `Bearer ${localStorage.getItem('vps_token')}`
  });

  const fetchUsers = async () => {
    setLoading(true);
    setListError('');
    try {
      const res = await fetch('/api/auth/users', { headers: authHeaders() });
      if (res.status === 401 || res.status === 403) return onLogout();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users');
      setUsers(data.users || []);
      setCurrentUserId(data.currentUserId);
    } catch (err) {
      setListError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!username.trim() || !password) {
      setFormError('Username and password are required');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }

    setAdding(true);
    try {
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ username: username.trim(), password })
      });
      if (res.status === 401 || res.status === 403) return onLogout();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add user');

      setUsername('');
      setPassword('');
      setConfirmPassword('');
      fetchUsers();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveUser = async (user) => {
    if (!window.confirm(`Remove "${user.username}"? They will no longer be able to log in.`)) return;

    setRemovingId(user.id);
    setListError('');
    try {
      const res = await fetch(`/api/auth/users/${user.id}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.status === 401 || res.status === 403) return onLogout();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove user');
      fetchUsers();
    } catch (err) {
      setListError(err.message);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content users-modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>👥 Shared Access</h3>
        <p style={{ marginTop: '-10px' }}>
          Everyone listed below can log in and see the same files. Add a friend by creating them a login.
        </p>

        {listError && <div className="error-message">{listError}</div>}

        {loading ? (
          <div className="loading-state" style={{ padding: '24px' }}>Loading...</div>
        ) : (
          <div className="user-list">
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <div className="user-row" key={user.id}>
                  <div className="user-row-name">
                    <span>👤 {user.username}</span>
                    {isSelf && <span className="user-badge">You</span>}
                  </div>
                  <button
                    type="button"
                    className="remove-user-btn"
                    disabled={isSelf || users.length <= 1 || removingId === user.id}
                    onClick={() => handleRemoveUser(user)}
                    title={isSelf ? "You can't remove yourself while logged in" : 'Remove access'}
                  >
                    {removingId === user.id ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <hr className="users-divider" />

        <div className="users-modal-section-title">Add someone new</div>
        {formError && <div className="error-message">{formError}</div>}
        <form onSubmit={handleAddUser}>
          <input
            type="text"
            placeholder="Their username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Choose a password for them"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          <div className="modal-actions">
            <button type="button" className="action-btn btn-secondary" onClick={onClose}>Close</button>
            <button type="submit" className="action-btn" disabled={adding}>
              {adding ? 'Adding...' : '+ Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
