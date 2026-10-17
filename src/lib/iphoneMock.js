import { useSyncExternalStore } from 'react'

// "iPhone screenshot mode": fakes the iOS status bar, safe areas and a Liquid
// Glass tab bar so desktop screenshots (DevTools device mode) look like they
// came from an iPhone. Saved per device; `?iphone=1` / `?iphone=0` in the URL
// (before or after the #) turns it on or off.
const KEY = 'iphone-mock'
const listeners = new Set()

function apply(on) {
  document.documentElement.classList.toggle('iphone-mock', on)
}

const hashQuery = window.location.hash.split('?')[1] || ''
const param = new URLSearchParams(window.location.search).get('iphone') ?? new URLSearchParams(hashQuery).get('iphone')
if (param !== null) localStorage.setItem(KEY, param === '0' ? '0' : '1')
let enabled = localStorage.getItem(KEY) === '1'
apply(enabled)

export function setIphoneMock(on) {
  enabled = on
  localStorage.setItem(KEY, on ? '1' : '0')
  apply(on)
  listeners.forEach(l => l())
}

export function useIphoneMock() {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l) },
    () => enabled,
  )
}
