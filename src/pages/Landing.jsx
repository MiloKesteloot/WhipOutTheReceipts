import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { version as buildVersion } from '../buildVersion.json'
import { LOGO_URL } from '../lib/logo.js'

// Signed-out home page: what Receipts is, for people arriving from search or
// a shared link. Images and the video come from `npm run screenshots`
// (showcase/shots.json → appAssets), which writes them to public/landing.
// ?v= changes every deploy, so browsers don't show cached images after a reshoot
const asset = name => `${import.meta.env.BASE_URL}landing/${name}?v=${buildVersion}`
const PORTFOLIO_URL = 'https://www.milo.games/receipts'
const GITHUB_URL = 'https://github.com/MiloKesteloot/WhipOutTheReceipts'

const primaryCta = 'inline-flex items-center justify-center px-6 py-3 rounded-xl bg-accent-600 text-white font-semibold shadow-sm hover:bg-accent-700 transition'
const secondaryCta = 'inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white border border-gray-200 text-gray-800 font-semibold hover:bg-gray-50 transition'

function PhoneFrame({ children, className = '' }) {
  return (
    <div className={`rounded-[2.6rem] bg-gray-900 p-[9px] shadow-2xl shadow-gray-900/25 ring-1 ring-gray-800 ${className}`}>
      <div className="rounded-[2.1rem] overflow-hidden bg-white">{children}</div>
    </div>
  )
}

function PhoneShot({ name, alt, className }) {
  return (
    <PhoneFrame className={className}>
      <img src={asset(`${name}.webp`)} alt={alt} width={585} height={1266} loading="lazy" className="block w-full h-auto" />
    </PhoneFrame>
  )
}

// iOS only autoplays when the muted *attribute* is set, which React doesn't
// always do, so set it on the element. Reduced-motion visitors get controls.
// It only plays while on screen.
function HeroVideo() {
  const ref = useRef(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.muted = true
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { video.controls = true; return }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) video.play().catch(() => { video.controls = true })
      else video.pause()
    }, { threshold: 0.25 })
    observer.observe(video)
    return () => observer.disconnect()
  }, [])
  return (
    <video
      ref={ref}
      src={asset('phone-hero.mp4')}
      poster={asset('phone-hero-poster.webp')}
      muted
      loop
      playsInline
      preload="auto"
      aria-label="Opening a Trader Joe's receipt and checking off items, with the running total updating"
      className="block w-full h-auto"
      width={780}
      height={1688}
    />
  )
}

const STEPS = [
  ['Add the receipt', 'Whoever paid types it in or takes a photo, and the photo gets read into items and prices.'],
  ['Check off what you had', 'Everyone goes through the list on their own phone. Things like paper towels can be set to split between everyone.'],
  ['See what you owe', 'Each item is split between the people who checked it, and tax and tip are split by how much each person spent.'],
]

// Kept true to how the app works: see receiptDebts (balances.js) for check-ins
// and the row-level security policies for who can read a group's data
const FAQ = [
  ['Is it free?', "Yes, it's free, and there are no ads."],
  ['Do my roommates need accounts?',
    "Roommates make a free account (Google or email) and join your group with its invite link. For someone who only joins now and then, anyone in the group can send them a guest link instead: they check off what they had without making an account."],
  ['Who can see our receipts?', "Only the people in your group. Nobody else can see your receipts, items or payments."],
  ['What if someone never checks in?',
    "Nobody owes anything on a receipt until everyone on it has checked in. The receipt and the home page show who it's still waiting on, so you know who to remind."],
  ['How does scanning a receipt work?',
    "Take a photo and Google's Gemini AI reads the store, items, prices, tax and tip into the form, for you to check before saving. It uses your own free API key from Google AI Studio, which you add once in Settings. You can always type a receipt in instead."],
  ['Does it work on my phone?', 'Yes, in any browser. Add it to your home screen and it opens like an app.'],
]

const FEATURES = [
  {
    shot: 'phone-claim', alt: "A Trader Joe's receipt with items checked off and a running total",
    title: 'Everyone checks off their own items',
    body: "Splitting a grocery run evenly doesn't really work, because nobody buys the same things. Each person checks off what's theirs and sees their total update as they go.",
  },
  {
    shot: 'phone-split', alt: 'Who owes what on a receipt, with an itemized breakdown per person',
    title: 'Tax and tip, split properly',
    body: "If you bought more, you pay more of the tax and tip. Everything is worked out to the cent, and leftover pennies are handed out so the totals add up to the receipt.",
  },
  {
    shot: 'phone-dining', alt: 'A restaurant receipt grouped into one meal per person',
    title: 'Restaurant bills',
    body: 'Group a dinner bill by person, so everyone can check off their whole order at once, along with their part of the tip.',
  },
  {
    shot: 'phone-payments', alt: 'Balances: who you owe, who owes you, and payment history',
    title: 'Paying each other back',
    body: "Your balances show who you owe and who owes you across every receipt. If two people owe each other, it cancels out and only the difference is left. When you pay someone, mark it as sent and it updates for both of you.",
  },
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Top bar */}
      <header className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg">
          <img src={LOGO_URL} alt="" width={32} height={32} className="w-8 h-8" />
          Receipts
        </Link>
        <nav className="flex items-center gap-2">
          <Link to="/signin" className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Sign in</Link>
          <Link to="/signup" className="px-4 py-2 rounded-lg bg-accent-600 text-white text-sm font-semibold hover:bg-accent-700 transition">Get started</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-16 sm:pt-16 sm:pb-24 grid md:grid-cols-[1.1fr_0.9fr] gap-10 md:gap-8 items-center">
          <div className="relative z-10 text-center md:text-left">
            <h1 className="font-extrabold tracking-tight">
              <span className="block whitespace-nowrap text-[clamp(1.75rem,8.4vw,3.25rem)] leading-[1.08]">Split grocery receipts</span>
              <span className="block whitespace-nowrap text-[clamp(1.75rem,8.4vw,3.25rem)] leading-[1.08] text-accent-600">with your roommates</span>
            </h1>
            <p className="mt-4 sm:mt-6 text-lg sm:text-xl text-gray-600 max-w-xl mx-auto md:mx-0">
              One person pays and adds the receipt. Everyone else checks off what they had,
              and the app works out what each person owes, tax and tip included.
            </p>
            <div className="mt-6 sm:mt-8 flex gap-3 justify-center md:justify-start">
              <Link to="/signup" className={`${primaryCta} flex-1 sm:flex-none`}>Get started</Link>
              <Link to="/signin" className={`${secondaryCta} flex-1 sm:flex-none`}>Sign in</Link>
            </div>
          </div>
          <div className="relative flex justify-center">
            {/* Green glow centered behind the phone */}
            <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[44rem] h-[44rem] max-w-[170vw] rounded-full bg-[radial-gradient(closest-side,rgb(var(--accent-200))_0%,rgb(var(--accent-100))_45%,transparent_100%)]" />
            <PhoneFrame className="relative w-[260px] sm:w-[300px] -rotate-2">
              <HeroVideo />
            </PhoneFrame>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center">How it works</h2>
          <ol className="mt-10 grid sm:grid-cols-3 gap-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="bg-white border border-gray-200 rounded-2xl p-6">
                <span className="w-9 h-9 rounded-full bg-accent-600 text-white font-bold flex items-center justify-center">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-gray-600">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features, alternating sides. On wider screens they're pulled together
          so each phone overlaps the previous one vertically (they're on
          opposite sides, so they nest instead of colliding). */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 md:py-20">
        {FEATURES.map((f, i) => (
          <section key={f.shot} className={`py-10 md:py-0 grid md:grid-cols-2 gap-10 md:gap-16 items-center ${i > 0 ? 'md:-mt-[148px]' : ''}`}>
            <div className={`text-center md:text-left ${i % 2 ? 'md:order-2' : ''}`}>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{f.title}</h2>
              <p className="mt-4 text-lg text-gray-600 max-w-lg mx-auto md:mx-0">{f.body}</p>
            </div>
            <div className="flex justify-center">
              <PhoneShot name={f.shot} alt={f.alt} className="w-[240px] sm:w-[270px]" />
            </div>
          </section>
        ))}
      </div>

      {/* Stats */}
      <section className="bg-gray-50 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Spending stats</h2>
            <p className="mt-4 text-lg text-gray-600">Because every item is tracked, you can see spending by month, category and store, what gets bought most, and how much each person has paid compared to what they actually used.</p>
          </div>
          <div className="mt-10 flex justify-center sm:hidden">
            <PhoneShot name="phone-stats" alt="Stats on a phone: what each person paid compared to what they used" className="w-[240px]" />
          </div>
          <div className="hidden sm:block mt-10 rounded-xl overflow-hidden bg-gray-200 shadow-2xl shadow-gray-900/15 ring-1 ring-gray-200">
            <div className="flex gap-1.5 px-3.5 py-3 bg-gray-100 border-b border-gray-200" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300" /><span className="w-2.5 h-2.5 rounded-full bg-gray-300" /><span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
            </div>
            <img src={asset('desktop-stats.webp')} alt="Stats page with spending per month and each person's fair share" width={1600} height={1000} loading="lazy" className="block w-full h-auto" />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center">Questions</h2>
        <div className="mt-8 divide-y divide-gray-200 border-y border-gray-200">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
                {q}
                <svg className="w-5 h-5 shrink-0 text-gray-400 transition-transform group-open:rotate-45" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" d="M10 4v12M4 10h12" />
                </svg>
              </summary>
              <p className="mt-2 text-gray-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Closing call to action */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 text-center">
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight">Try it with your roommates</h2>
        <p className="mt-4 text-lg text-gray-600">Make a group, send everyone the invite link, and add your first receipt.</p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/signup" className={primaryCta}>Get started</Link>
          <Link to="/signin" className={secondaryCta}>I already have an account</Link>
        </div>
      </section>

      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid gap-6 sm:grid-cols-[1fr_auto] items-start text-sm text-gray-500">
          <div className="space-y-2 text-center sm:text-left">
            <Link to="/" className="inline-flex items-center gap-2 font-bold text-base text-gray-900">
              <img src={LOGO_URL} alt="" width={28} height={28} className="w-7 h-7" />
              Receipts
            </Link>
            <p>Your group's receipts and payments are only visible to the people in your group.</p>
            <p>Made by <a href="https://www.milo.games/" className="text-gray-700 hover:text-gray-900 underline-offset-2 hover:underline">Milo Kesteloot</a></p>
          </div>
          <nav className="flex justify-center sm:justify-end gap-5">
            <a href={PORTFOLIO_URL} className="hover:text-gray-800">How it's built</a>
            <a href={GITHUB_URL} className="hover:text-gray-800">GitHub</a>
            <a href={`${GITHUB_URL}/issues`} className="hover:text-gray-800">Feedback</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
