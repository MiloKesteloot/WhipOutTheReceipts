import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useSession } from '../lib/session.jsx'
import { useDialog } from '../lib/useDialog.jsx'
import Select from './Select.jsx'

// Settings → Discord: connect your Discord so the OurReceipts bot DMs you
// (supabase/functions/discord, supabase/DISCORD.md). Connecting goes
// through Discord's own "Authorize" page and comes back here with
// ?discord=connected (or =error&reason=…, =cancelled).

const card = 'bg-white border border-gray-200 rounded-xl p-4'
const sectionTitle = 'text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3'
const buttonBase = 'inline-flex items-center justify-center shrink-0 h-11 sm:h-10 px-3 text-sm rounded-lg transition disabled:opacity-50'
const smallButton = `${buttonBase} border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100`
const dangerSmall = `${buttonBase} border border-red-200 text-red-500 hover:bg-red-50 active:bg-red-50`
const discordButton = `${buttonBase} w-full font-medium bg-[#5865F2] text-white hover:bg-[#4752C4] active:bg-[#4752C4]`

const EVENTS = [
  ['notify_new_receipt', 'New receipts', "A receipt you're on was added"],
  ['notify_items_added', 'Items added', 'Something was added after you checked in, so you need to check in again'],
  ['notify_price_up', 'Price went up', 'On something you checked off'],
  ['notify_payment', 'Payments to you', 'Someone marked money as sent to you'],
]
const EVERY = [
  { value: 0, label: 'Off' }, { value: 1, label: 'Every day' }, { value: 2, label: 'Every 2 days' },
  { value: 3, label: 'Every 3 days' }, { value: 7, label: 'Every week' },
]
const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h, label: `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`,
}))
const ERRORS = {
  expired: 'That took too long. Try connecting again.',
  login: "Discord didn't finish logging you in. Try again.",
  server: "Couldn't add you to the OurReceipts server. Try again in a minute.",
  too_many_servers: "You're in the most servers Discord allows (200), so you can't join the OurReceipts server. Leave one and try again.",
  save: "Couldn't save the connection. Try again.",
}

// The function's error message, if it sent one
async function callFn(path, body) {
  const { data, error } = await supabase.functions.invoke(`discord/${path}`, { body: body || {} })
  if (error) {
    const detail = await error.context?.json?.().catch(() => null)
    throw new Error(detail?.error || "Couldn't reach the notification service. Try again in a minute.")
  }
  return data
}

function Toggle({ on, onChange, label, hint }) {
  return (
    <label className="flex items-center justify-between cursor-pointer gap-4">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${on ? 'bg-accent-500' : 'bg-gray-200'}`}
      >
        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </label>
  )
}

export default function DiscordSettings() {
  const { session } = useSession()
  const { confirm, showAlert, DialogUI } = useDialog()
  const [params, setParams] = useSearchParams()
  const [link, setLink] = useState(undefined) // undefined: loading, null: not connected
  const [busy, setBusy] = useState(null) // 'connect' | 'test' | 'disconnect'
  const [note, setNote] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('discord_links').select('*').eq('user_id', session.user.id).maybeSingle()
    setLink(error ? null : data)
  }
  useEffect(() => { load() }, [])

  // Back from Discord
  useEffect(() => {
    const result = params.get('discord')
    if (!result) return
    if (result === 'connected') setNote({ ok: true, text: "Connected! The bot sent you a message on Discord." })
    else if (result === 'error') setNote({ ok: false, text: ERRORS[params.get('reason')] || "Couldn't connect Discord. Try again." })
    const next = new URLSearchParams(params)
    next.delete('discord'); next.delete('reason')
    setParams(next, { replace: true })
    load()
  }, [params])

  async function connect() {
    setBusy('connect')
    try {
      const { url } = await callFn('start', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      window.location.href = url
    } catch (e) {
      setBusy(null)
      await showAlert(e.message, { title: "Couldn't connect Discord" })
    }
  }

  async function update(changes) {
    const before = link
    setLink({ ...link, ...changes })
    const { error } = await supabase.from('discord_links').update(changes).eq('user_id', session.user.id)
    if (error) { setLink(before); await showAlert(error.message, { title: "Couldn't save that" }) }
  }

  async function sendTest() {
    setBusy('test'); setNote(null)
    try {
      await callFn('test')
      setNote({ ok: true, text: 'Sent! Check your Discord DMs.' })
    } catch (e) {
      setNote({ ok: false, text: e.message })
    }
    await load()
    setBusy(null)
  }

  async function disconnect() {
    if (!await confirm("The bot will stop messaging you, and you'll leave the OurReceipts Discord server.", { title: 'Disconnect Discord?', confirmLabel: 'Disconnect' })) return
    setBusy('disconnect'); setNote(null)
    try {
      await callFn('disconnect')
      setLink(null)
    } catch (e) {
      await showAlert(e.message, { title: "Couldn't disconnect" })
    }
    setBusy(null)
  }

  if (link === undefined) return null

  return (
    <section data-discord-settings>
      {DialogUI}
      <h2 className={sectionTitle}>Discord notifications</h2>
      <div className={`${card} space-y-4`}>
        {note && (
          <p role="status" className={`text-sm rounded-lg px-3 py-2 ${note.ok ? 'bg-accent-50 text-accent-700' : 'bg-red-50 text-red-600'}`}>{note.text}</p>
        )}
        {!link ? (
          <>
            <p className="text-sm text-gray-600">
              Get a Discord message when a receipt you're on is added, when you need to check in again, and more.
            </p>
            <p className="text-xs text-gray-400">
              Discord only lets a bot message people it shares a server with, so connecting also adds you to a small,
              read-only OurReceipts server. You can mute it.
            </p>
            <button onClick={connect} disabled={!!busy} className={discordButton}>
              {busy === 'connect' ? 'Opening Discord…' : 'Connect Discord'}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-700 min-w-0 truncate">Connected as <span className="font-medium">@{link.discord_username}</span></p>
              <button onClick={sendTest} disabled={!!busy} className={smallButton}>{busy === 'test' ? 'Sending…' : 'Send a test'}</button>
            </div>
            {link.broken_at && (
              <div className="text-sm bg-amber-50 text-amber-800 rounded-lg px-3 py-2">
                <p>The bot can't message you. You may have left the OurReceipts server, or turned off DMs from its members.</p>
                <button onClick={connect} disabled={!!busy} className="mt-1 font-medium underline">Connect again</button>
              </div>
            )}
            <div className="space-y-4 pt-1">
              {EVENTS.map(([key, label, hint]) => (
                <Toggle key={key} on={link[key]} onChange={v => update({ [key]: v })} label={label} hint={hint} />
              ))}
            </div>
            <div className="pt-1">
              <p className="text-sm font-medium text-gray-800">Reminders</p>
              <p className="text-xs text-gray-400 mt-0.5 mb-2">About receipts still waiting on you to check off</p>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <Select small value={link.remind_every_days} onChange={v => update({ remind_every_days: v })} options={EVERY} ariaLabel="How often" />
                </div>
                {link.remind_every_days > 0 && (
                  <div className="flex-1 min-w-0">
                    <Select small value={link.remind_hour} onChange={v => update({ remind_hour: v, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone })} options={HOURS} ariaLabel="At" />
                  </div>
                )}
              </div>
            </div>
            <button onClick={disconnect} disabled={!!busy} className={`${dangerSmall} w-full`}>
              {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect Discord'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
