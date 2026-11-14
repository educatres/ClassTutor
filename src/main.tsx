import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { registerPwa } from './pwa'
import { applyTheme, readStoredTheme } from './theme'

registerPwa()
applyTheme(readStoredTheme())
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
