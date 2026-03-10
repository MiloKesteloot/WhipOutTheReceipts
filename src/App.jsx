import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'
import TripDetail from './pages/TripDetail.jsx'
import AddReceipt from './pages/AddReceipt.jsx'

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/trip/:id" element={<TripDetail />} />
        <Route path="/trip/:id/add-receipt" element={<AddReceipt />} />
        <Route path="/trip/:id/receipt/:receiptId/edit" element={<AddReceipt />} />
      </Routes>
    </div>
  )
}
