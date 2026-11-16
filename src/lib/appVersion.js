import { useEffect, useState } from 'react'
import { version as runningVersion } from '../buildVersion.json'

// Is a newer version of the app deployed than the one running? Each deploy
// publishes version.json next to the app (scripts/deploy.mjs). Checked when
// you come back to the app and every so often; in dev there's no file, so
// it never says so.
const CHECK_EVERY_MS = 15 * 60 * 1000

export async function fetchDeployedVersion() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const { version } = await res.json()
    return Number.isInteger(version) ? version : null
  } catch {
    return null
  }
}

export function useNewVersion() {
  const [newer, setNewer] = useState(false)
  useEffect(() => {
    let stopped = false
    const check = async () => {
      const deployed = await fetchDeployedVersion()
      if (!stopped && deployed && deployed > runningVersion) setNewer(true)
    }
    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => { stopped = true; document.removeEventListener('visibilitychange', onVisible); clearInterval(timer) }
  }, [])
  return newer
}
