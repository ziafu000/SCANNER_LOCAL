import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { Analytics } from '@vercel/analytics/react'
import './style.css'

// Seamless reload when a new service worker takes control (iOS optimized auto-update)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload()
  })
}

createRoot(document.getElementById('root')).render(
  <>
    <App />
    <Analytics />
  </>,
)
