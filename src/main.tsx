import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import './styles/global.css'

const root = createRoot(document.getElementById('root')!)

if (import.meta.env.VITE_API_MODE === 'mock') {
  void import('./app/LocalDemoApp').then(({ LocalDemoApp }) => {
    root.render(<StrictMode><LocalDemoApp /></StrictMode>)
  })
} else {
  root.render(<StrictMode><App /></StrictMode>)
}
