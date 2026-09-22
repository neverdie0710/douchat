import './diagnostics'
import { ChatErrorBoundary } from './components/ChatErrorBoundary'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Chromium's backdrop-filter compositing can drop fixed dialog layers on
// Windows. Expose the trusted platform value from preload to CSS so dialogs
// can use a non-filtered fallback there without changing the macOS treatment.
document.documentElement.dataset.platform = window.douchat.platform

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatErrorBoundary root><App /></ChatErrorBoundary>
  </StrictMode>
)
