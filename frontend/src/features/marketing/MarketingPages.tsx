import { Link } from 'react-router-dom';
import { BarChart3, Building2, Camera, Check, Fingerprint, Lock, MapPin, QrCode, Radio, Shield, Upload, Users } from 'lucide-react';

const FEATURES = [
  { icon: QrCode, title: 'Dynamic, expiring QR codes', body: 'Unpredictable 256-bit tokens, configurable expiry from 5 minutes, instant revocation and optional 30-second rotation to stop screenshot sharing.' },
  { icon: MapPin, title: 'GPS geofencing', body: 'The server — never the phone — computes distance from the lecturer’s location and enforces your radius and accuracy rules.' },
  { icon: Fingerprint, title: 'Automatic student ID check', body: 'Your own ID format, a live 0/8 counter, and automatic verification the moment the ID is complete. No buttons, no accounts.' },
  { icon: Camera, title: 'Selfie capture', body: 'Front-camera photo, metadata stripped, stored privately per organization with short-lived links and automatic deletion.' },
  { icon: Radio, title: 'Live lecturer dashboard', body: 'Watch check-ins arrive in real time, see who is absent, correct records with an audit trail.' },
  { icon: BarChart3, title: 'Reports & exports', body: 'Trends, per-student rates and CSV / Excel / PDF exports generated in the background.' },
  { icon: Upload, title: 'Bulk import', body: 'CSV or Excel with column mapping, preview, duplicate detection and downloadable error reports.' },
  { icon: Building2, title: 'Built for every institution', body: 'Universities, colleges, schools, training providers and event organizers each configure their own structure.' },
  { icon: Shield, title: 'Strict tenant isolation', body: 'Every organization’s data is isolated in the application and enforced again by PostgreSQL row-level security.' },
];

export function LandingPage() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-white to-white">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700"><Lock className="h-3.5 w-3.5" /> Secure multi-tenant attendance</p>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">Attendance your students can’t fake from the hostel.</h1>
            <p className="mt-5 text-lg text-slate-600">NTS combines expiring QR codes, server-side GPS geofencing, automatic student ID verification and selfie capture — so every check-in means someone was actually there.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">Register your organization</Link>
              <Link to="/features" className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">See how it works</Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">Students don’t need an account — they just scan.</p>
          </div>
          <div className="mx-auto w-full max-w-sm">
            <div className="rounded-[2.5rem] border-8 border-slate-900 bg-white p-5 shadow-2xl">
              <p className="text-xs text-slate-500">Demo University</p>
              <p className="font-semibold">CS201 — Data Structures</p>
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700"><MapPin className="h-4 w-4" /> Within the attendance area</div>
                <div className="rounded-lg border border-slate-200 p-3"><p className="text-xs text-slate-500">Student ID</p><p className="flex justify-between font-mono">20240017 <span className="text-emerald-600">8/8</span></p></div>
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3"><div className="h-10 w-10 rounded-full bg-brand-100" /><div><p className="text-sm font-medium">Aminata Sesay</p><p className="text-xs text-slate-500">BSc Computer Science · Year 2</p></div></div>
                <div className="rounded-lg bg-brand-600 py-3 text-center text-sm font-semibold text-white">Record my attendance</div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-semibold text-slate-900">Everything an institution needs</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.slice(0, 6).map((f) => (
            <div key={f.title} className="card p-6"><f.icon className="h-6 w-6 text-brand-600" /><h3 className="mt-4 font-semibold">{f.title}</h3><p className="mt-2 text-sm text-slate-600">{f.body}</p></div>
          ))}
        </div>
      </section>
      <section className="bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6">
          <h2 className="text-2xl font-semibold text-white">Ready in an afternoon</h2>
          <p className="max-w-2xl text-slate-300">Create your organization, import students from Excel, invite lecturers and run your first QR session the same day.</p>
          <Link to="/register" className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">Get started</Link>
        </div>
      </section>
    </>
  );
}

export function FeaturesPage() {
  const steps = ['Lecturer starts a session and projects the QR code', 'Student scans it — no app, no account', 'Phone shares its location; the server checks the geofence', 'Student types their ID; it verifies automatically when complete', 'Student takes a selfie', 'Attendance is recorded once — duplicates are impossible', 'The lecturer sees it live'];
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold text-slate-900">Features</h1>
      <p className="mt-2 max-w-2xl text-slate-600">Defense in depth for attendance integrity, without friction for students.</p>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card p-6"><f.icon className="h-6 w-6 text-brand-600" /><h3 className="mt-4 font-semibold">{f.title}</h3><p className="mt-2 text-sm text-slate-600">{f.body}</p></div>
        ))}
      </div>
      <h2 className="mt-16 text-2xl font-semibold">How a check-in works</h2>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2">
        {steps.map((s, i) => <li key={s} className="flex gap-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{i + 1}</span><span className="text-sm text-slate-700">{s}</span></li>)}
      </ol>
      <p className="mt-8 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">Honest note: browser GPS and selfies raise the bar significantly but are not cryptographic proof of presence or identity. NTS records verification signals and flags anomalies so staff can review them.</p>
    </div>
  );
}

const PLANS = [
  { name: 'Starter', price: 'Free', note: 'For pilots and small classes', items: ['Up to 300 students', '2 staff accounts', 'QR + location + ID verification', 'CSV export'] },
  { name: 'Institution', price: 'Contact us', note: 'For schools and colleges', items: ['Unlimited students', 'Unlimited staff & custom roles', 'Selfies with retention controls', 'Excel & PDF reports', 'Priority support'], featured: true },
  { name: 'Enterprise', price: 'Contact us', note: 'Universities and multi-campus groups', items: ['Everything in Institution', 'Student information system integration', 'Dedicated environment options', 'SLA & security review'] },
];

export function PricingPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <h1 className="text-center text-3xl font-semibold">Pricing</h1>
      <p className="mt-2 text-center text-slate-600">Plans are informational while billing is being introduced.</p>
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.name} className={`card p-6 ${p.featured ? 'ring-2 ring-brand-500' : ''}`}>
            <h2 className="font-semibold">{p.name}</h2>
            <p className="mt-2 text-3xl font-semibold">{p.price}</p>
            <p className="text-sm text-slate-500">{p.note}</p>
            <ul className="mt-6 space-y-2 text-sm">{p.items.map((i) => <li key={i} className="flex gap-2"><Check className="h-4 w-4 text-emerald-600" /> {i}</li>)}</ul>
            <Link to={p.price === 'Free' ? '/register' : '/contact'} className="mt-6 block rounded-lg bg-brand-600 py-2 text-center text-sm font-semibold text-white hover:bg-brand-700">{p.price === 'Free' ? 'Start free' : 'Talk to us'}</Link>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold">About NTS</h1>
      <p className="mt-4 text-slate-600">NTS is built by NTS Digital Solutions to give institutions trustworthy attendance data without paper registers or proxy sign-ins. We designed it as a multi-tenant SaaS from day one: each organization’s students, records and photos are isolated and governed by its own settings.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[[Users, 'Privacy first', 'Minimal student data, masked emails, short-lived photo links, configurable retention.'], [Shield, 'Secure by design', 'Argon2id passwords, rotating sessions, MFA, RLS, append-only audit trail.'], [Building2, 'Flexible', 'Works for universities and one-off events alike.']].map(([Icon, t, b]) => {
          const I = Icon as typeof Users;
          return <div key={t as string} className="card p-5"><I className="h-5 w-5 text-brand-600" /><h3 className="mt-3 font-semibold">{t as string}</h3><p className="mt-1 text-sm text-slate-600">{b as string}</p></div>;
        })}
      </div>
    </div>
  );
}

export function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold">Contact</h1>
      <p className="mt-4 text-slate-600">For demos, pricing or onboarding help, reach the NTS Digital Solutions team through your account manager, or create an account and use the in-app organization settings to get started right away.</p>
      <div className="card mt-8 p-6 text-sm text-slate-600">
        <p className="font-medium text-slate-900">Already a customer?</p>
        <p className="mt-1">Sign in and your organization administrator can manage users, roles and settings directly.</p>
        <Link to="/login" className="mt-4 inline-block font-medium text-brand-700">Sign in →</Link>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-semibold text-brand-600">404</p>
      <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-6 text-sm font-medium text-brand-700">Go home</Link>
    </div>
  );
}
