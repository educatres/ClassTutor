import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import TeacherApp from './TeacherApp'
import './styles.css'
import { registerPwa } from './pwa'
import { applyTheme, readStoredTheme } from './theme'

registerPwa()
applyTheme(readStoredTheme())
createRoot(document.getElementById('teacher-root')!).render(<StrictMode><TeacherApp /></StrictMode>)
