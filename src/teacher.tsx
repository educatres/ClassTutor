import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import TeacherApp from './TeacherApp'
import './styles.css'

createRoot(document.getElementById('teacher-root')!).render(<StrictMode><TeacherApp /></StrictMode>)
