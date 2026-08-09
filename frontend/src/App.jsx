import { useState, useEffect } from 'react';
import RegisterForm from './components/RegisterForm';
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';
import SettingsMenu from './components/SettingsMenu';
import './App.css'; 

function App() {
  const [appState, setAppState] = useState('loading'); 
  
  useEffect(() => {
    fetch('/api/auth/setup-status')
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          throw new Error(text || 'Backend request failed');
        }
        const data = JSON.parse(text);

        if (data.needsSetup) {
          setAppState('register');
        } else {
          const token = localStorage.getItem('vps_token');
          if (token) {
              setAppState('dashboard');
          } else {
              setAppState('login');
          }
        }
      })
      .catch(err => {
        console.error("Failed to connect to backend", err);
        setAppState('error');
      });
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('vps_token');
    setAppState('login');
  };

  if (appState === 'loading') {
    return (
      <div className="status-screen">
        <div className="status-card">
          <span className="brand-mark" aria-hidden="true">📁</span>
          <p className="status-text">Connecting to server…</p>
        </div>
      </div>
    );
  }

  if (appState === 'error') {
    return (
      <div className="status-screen">
        <div className="status-card status-card-error">
          <span className="brand-mark" aria-hidden="true">⚠️</span>
          <p className="status-text">Couldn't reach the backend. Is it running?</p>
        </div>
      </div>
    );
  }

  // We remove the standard app-container wrapper ONLY for the dashboard so it can grow wider
  if (appState === 'dashboard') {
    return (
      <>
        <SettingsMenu />
        <div className="app-container app-container-wide">
          <Dashboard onLogout={handleLogout} />
        </div>
      </>
    );
  }

  return (
    <>
      <SettingsMenu />
      <div className="app-container">
        <div className="brand-header">
          <span className="brand-mark" aria-hidden="true">📁</span>
          <span className="brand-name">File Manager</span>
        </div>

        {appState === 'register' &&
          <div>
            <h2>Initial Setup</h2>
            <p>Welcome! Create the master admin account to secure your file manager.</p>
            <RegisterForm onRegistered={() => setAppState('login')} />
          </div>
        }

        {appState === 'login' &&
          <div>
            <h2>Welcome back</h2>
            <p>Sign in to access your files.</p>
            <LoginForm onLogin={() => setAppState('dashboard')} />
          </div>
        }
      </div>
    </>
  );
}

export default App;