import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'
import TripDetail from './pages/TripDetail.jsx'
import AddReceipt from './pages/AddReceipt.jsx'
import Welcome from './pages/Welcome.jsx'

export default function App() {
  const [myName, setMyName] = useState(() => localStorage.getItem('global-name') || '')

  function handleNameSet(name) {
    const normalized = name.trim().replace(/\b\w/g, c => c.toUpperCase())
    localStorage.setItem('global-name', normalized)
    setMyName(normalized)
  }

  function handleSignOut() {
    localStorage.removeItem('global-name')
    setMyName('')
  }

  if (!myName) {
    return <Welcome onNameSet={handleNameSet} />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto px-4 pt-3 pb-1 flex items-center justify-between text-sm text-gray-500">
        <span>Signed in as <strong className="text-gray-800">{myName}</strong></span>
        <button onClick={handleSignOut} className="text-xs text-indigo-500 hover:underline">
          Sign out
        </button>
      </div>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/trip/:id" element={<TripDetail />} />
        <Route path="/trip/:id/add-receipt" element={<AddReceipt />} />
        <Route path="/trip/:id/receipt/:receiptId/edit" element={<AddReceipt />} />
      </Routes>
    </div>
  )
}
