import { useState, useEffect } from 'react';
import RegisterForm from './components/RegisterForm';
import LoginForm from './components/LoginForm';
import './App.css';

function App() {
  const [appState, setAppState] = useState('loading'); // 'loading', 'register', 'login', 'dashboard'
  
  useEffect(() => {
    // Check if the app needs initial setup
    fetch('http://localhost:3000/api/auth/setup-status')
      .then(res => res.json())
      .then(data => {
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

  if (appState === 'loading') return <div>Connecting to server...</div>;
  if (appState === 'error') return <div>Error connecting to the backend. Is it running?</div>;

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
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

      {appState === 'dashboard' && 
        <div>
          <h2>File Manager Dashboard</h2>
          <p>You are logged in! The file system will go here.</p>
          <button onClick={() => {
              localStorage.removeItem('vps_token');
              setAppState('login');
          }}>Log Out</button>
        </div>
      }
    </div>
  )
}

export default App;