import { useState, useEffect } from 'react';
import RegisterForm from './components/RegisterForm';
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';
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

  if (appState === 'loading') return <div>Connecting to server...</div>;
  if (appState === 'error') return <div>Error connecting to the backend. Is it running?</div>;

  // We remove the standard app-container wrapper ONLY for the dashboard so it can grow wider
  if (appState === 'dashboard') {
    return (
      <div className="app-container" style={{ maxWidth: '800px' }}>
        <Dashboard onLogout={handleLogout} />
      </div>
    );
  }

  return (
    <div className="app-container">
      {appState === 'register' && 
        <div>
          <h2>Initial Setup</h2>
          <p>Welcome! Create the master admin account to secure your file manager.</p>
          <RegisterForm onRegistered={() => setAppState('login')} />
        </div>
      }

      {appState === 'login' && 
        <div>
          <h2>Login</h2>
          <LoginForm onLogin={() => setAppState('dashboard')} />
        </div>
      }
    </div>
  );
}

export default App;