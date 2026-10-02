import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { SettingsActionsProvider } from './context/SettingsActionsContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <SettingsActionsProvider>
        <App />
      </SettingsActionsProvider>
    </ThemeProvider>
  </StrictMode>,
)
