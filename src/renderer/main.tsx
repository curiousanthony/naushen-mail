import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './app/App'
import { initAppearance } from './features/settings/lib/appearance'

initAppearance()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
