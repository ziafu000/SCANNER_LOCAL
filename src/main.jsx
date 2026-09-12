import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './style.css'

// PWA auto-update: when a new service worker takes control, reload seamlessly
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload()
  })
}

createRoot(document.getElementById('root')).render(<App />)
