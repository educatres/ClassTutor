import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import TeacherApp from './TeacherApp'
import './styles.css'
import { registerPwa } from './pwa'

registerPwa()
createRoot(document.getElementById('teacher-root')!).render(<StrictMode><TeacherApp /></StrictMode>)
