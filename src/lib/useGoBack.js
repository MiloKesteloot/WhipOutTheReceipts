import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

// Is there an earlier screen in this tab's history, within the app? (React
// Router numbers its history entries; 0 is where this visit started.)
export function canGoBack(steps = 1) {
  return (window.history.state?.idx ?? 0) >= steps
}

// Back buttons: go back to the previous screen, like the phone's back
// gesture, so you land where you came from (with its search, view, etc.).
// Opened straight from a link, with nothing to go back to: go to `fallback`.
export function useGoBack() {
  const navigate = useNavigate()
  return useCallback((fallback = '/', steps = 1) => {
    if (canGoBack(steps)) navigate(-steps)
    else navigate(fallback, { replace: true })
  }, [navigate])
}
