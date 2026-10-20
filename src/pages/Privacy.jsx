import { Link } from 'react-router-dom'
import { LOGO_URL } from '../lib/logo.js'

const sections = [
  {
    title: 'Information the app stores',
    body: <>
      <p>When you create an account, the app stores your email address and profile name. If you use Google sign-in, Google handles that sign-in and shares the account information needed to create your app account.</p>
      <p>Groups can contain member names, including people who do not have an account. Receipts can include store names, dates, categories, item names and prices, tax, tip, fees, who paid, and who claimed or checked off each item. The app also stores group activity and payment records that members enter. Payment records track amounts between people; the app does not move money.</p>
      <p>If you save a Gemini API key in Settings, it is stored with your account so you can use receipt scanning. The app also saves your sign-in session and some preferences in your browser's local storage.</p>
    </>,
  },
  {
    title: 'How information is used and shared',
    body: <>
      <p>Information is used to sign you in, show your groups and receipts, calculate balances and spending summaries, and keep group history. Members of a group can see that group's information.</p>
      <p>A guest link lets anyone who has the link see the specific receipt shared through it and check off items for that guest. Treat guest links as private and share them only with the intended person.</p>
      <p>The app is hosted with Supabase, which provides sign-in and database services. If you scan a receipt, the selected image and your Gemini API key are sent from your browser to Google's Gemini API to read the receipt. Scanning is optional; you can enter receipt details yourself. The app does not store the image as part of the receipt record.</p>
    </>,
  },
  {
    title: 'Your choices and deleting your account',
    body: <>
      <p>You can update your profile and remove your saved Gemini API key in Settings. You can also delete your account there.</p>
      <p>Deleting an account removes its login, profile, and saved API key. In a group with other account holders, your name and past receipt and payment history remain so the group's records and balances still make sense; you leave the group. A group with no other account holders is deleted.</p>
    </>,
  },
  {
    title: 'Questions',
    body: <p>For privacy questions, use the <a className="text-accent-700 underline underline-offset-2" href="https://github.com/MiloKesteloot/WhipOutTheReceipts/issues">Feedback page</a>. Please do not post passwords, receipt images, or other sensitive information in a public issue.</p>,
  },
]

export default function Privacy() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 font-bold text-base">
            <img src={LOGO_URL} alt="" width={28} height={28} className="w-7 h-7" />
            Receipts
          </Link>
          <Link to="/" className="text-sm text-gray-600 hover:text-gray-900">Back to home</Link>
        </div>
      </header>
      <article className="max-w-3xl mx-auto px-5 sm:px-6 py-12 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-sm text-gray-500">Last updated October 20, 2026</p>
        <p className="mt-6 text-gray-700 leading-7">This policy explains what information Whip Out the Receipts handles and how it is used when you use the app.</p>
        <div className="mt-10 space-y-8">
          {sections.map(({ title, body }) => (
            <section key={title}>
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
              <div className="mt-3 space-y-3 text-gray-700 leading-7">{body}</div>
            </section>
          ))}
        </div>
      </article>
    </main>
  )
}
