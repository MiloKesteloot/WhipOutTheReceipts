import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

// A "data router" (not <HashRouter>) so pages can ask before leaving with
// unsaved changes (useBlocker) and scroll positions come back on Back
// (<ScrollRestoration>). App keeps its own <Routes> inside.
const router = createHashRouter([{ path: '*', element: <App /> }])

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
