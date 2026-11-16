import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ShieldCheck } from 'lucide-react';

const UPDATED = '15 November 2026';

type Section = { id: string; title: string; body: ReactNode };

function LegalLayout({ title, intro, icon, sections, other }: { title: string; intro: ReactNode; icon: ReactNode; sections: Section[]; other: { to: string; label: string } }) {
  return (
    <div className="bg-app">
      <section className="bg-hero animate-gradient relative overflow-hidden text-white">
        <div className="pointer-events-none absolute -top-16 right-10 h-56 w-56 rounded-full bg-cyan-400/25 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 pt-32 pb-12 sm:px-6 sm:pt-36 sm:pb-16">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">{icon}</span>
          <h1 className="mt-4 text-3xl font-extrabold sm:text-4xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-white/75">{intro}</p>
          <p className="mt-4 text-xs font-semibold tracking-wider text-cyan-200 uppercase">Last updated {UPDATED}</p>
        </div>
      </section>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[15rem_1fr]">
        <nav className="hidden lg:block" aria-label="Contents">
          <div className="card sticky top-24 p-4">
            <p className="mb-2 text-xs font-bold tracking-wider text-slate-400 uppercase">Contents</p>
            <ol className="space-y-1 text-sm">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-lg px-2 py-1.5 text-slate-600 transition hover:bg-brand-50 hover:text-brand-700">
                    {i + 1}. {s.title}
                  </a>
                </li>
              ))}
            </ol>
            <Link to={other.to} className="mt-4 block rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-brand-700">
              Read the {other.label} →
            </Link>
          </div>
        </nav>
        <article className="card p-6 sm:p-10">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 border-b border-slate-100 py-6 first:pt-0 last:border-0 last:pb-0">
              <h2 className="text-lg font-extrabold text-navy-900">
                {i + 1}. {s.title}
              </h2>
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-slate-600 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_strong]:text-navy-800 [&_ul]:space-y-1.5">{s.body}</div>
            </section>
          ))}
          <p className="mt-8 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
            See also our <Link to={other.to} className="font-semibold text-brand-700">{other.label}</Link>.
          </p>
        </article>
      </div>
    </div>
  );
}

const SUBPROCESSORS = (
  <ul>
    <li><strong>Neon</strong> — managed PostgreSQL database hosting (primary data store).</li>
    <li><strong>Cloudinary</strong> — private storage of uploaded files, including attendance selfies, logos, profile pictures, imports and reports.</li>
    <li><strong>Brevo</strong> — delivery of transactional emails such as verification codes and notifications.</li>
    <li><strong>Cloudflare R2</strong> — encrypted storage of database backups used for disaster recovery.</li>
    <li><strong>Render</strong> — application hosting.</li>
    <li><strong>Google</strong> — optional “Continue with Google” sign-in, only for users who choose it.</li>
  </ul>
);

export function PrivacyPage() {
  const sections: Section[] = [
    {
      id: 'who', title: 'Who we are and our role',
      body: (
        <>
          <p>NTSAttend is an attendance platform operated by NTS Digital Solutions (“we”, “us”). Universities, colleges, schools, training providers and event organizers (“institutions”) use NTSAttend to record attendance.</p>
          <p>For <strong>student and participant data</strong>, the institution decides why and how the data is used; we process it on the institution’s behalf and under its instructions. For <strong>staff account data</strong> (people who sign in to NTSAttend), we are responsible for that data.</p>
        </>
      ),
    },
    {
      id: 'collect', title: 'Information we collect',
      body: (
        <>
          <p><strong>Staff accounts:</strong> name, email address, optional phone number and profile picture, password (stored only as a one-way hash), optional two-step verification settings, organization memberships and roles, and sign-in records (time, IP address, device type).</p>
          <p><strong>Student and participant records</strong> provided by institutions: student ID, name, email, program, department, level, academic year and enrollment status.</p>
          <p><strong>At each attendance check-in:</strong></p>
          <ul>
            <li>the student ID entered and the session checked into;</li>
            <li>the device location and reported accuracy <em>at that moment only</em>, used to confirm presence at the venue (we do not track location continuously);</li>
            <li>a selfie photo, if the institution requires one (image metadata such as GPS tags is removed before storage);</li>
            <li>a one-way hash of the device’s network address, used only to detect abuse such as repeated guessing of student IDs;</li>
            <li>the server time of submission.</li>
          </ul>
          <p><strong>Other:</strong> support conversations and feedback you send us, and security and audit logs of actions in the platform.</p>
        </>
      ),
    },
    {
      id: 'use', title: 'How we use information',
      body: (
        <ul>
          <li>To provide the service: verify students, record attendance, produce reports and exports, and send account emails.</li>
          <li>To keep the service secure: prevent fraud, enumeration and unauthorized access, and keep audit trails.</li>
          <li>To support institutions and improve NTSAttend based on feedback.</li>
        </ul>
      ),
    },
    {
      id: 'legal', title: 'Legal bases',
      body: <p>We process staff account data to perform our contract with you and the institution, and for our legitimate interest in operating a secure service. Institutions are responsible for having a lawful basis (for example consent, contract or public task) for the student data they upload and the attendance checks they require, and for informing their students.</p>,
    },
    { id: 'share', title: 'Who we share information with', body: <><p>We never sell personal data. We use the following service providers, which process data only to provide their service to us:</p>{SUBPROCESSORS}<p>We may disclose information if required by law. Each institution’s data is isolated and is never visible to other institutions.</p></> },
    {
      id: 'retention', title: 'How long we keep information',
      body: (
        <ul>
          <li>Selfies are deleted automatically after the institution’s retention period (180 days by default, configurable).</li>
          <li>Attendance records are kept while the institution’s account is active, or until the institution deletes them.</li>
          <li>Database backups are deleted after 30 days.</li>
          <li>Pending sign-ups and verification codes expire within minutes and are removed.</li>
        </ul>
      ),
    },
    {
      id: 'security', title: 'Security',
      body: <p>Data is encrypted in transit. Passwords are hashed with Argon2id. Files are private and reachable only through short-lived signed links. Each institution’s data is separated at the application and database level, sensitive actions are recorded in an append-only audit log, and staff can enable two-step verification.</p>,
    },
    {
      id: 'rights', title: 'Your rights',
      body: (
        <>
          <p>Depending on where you live, you may have rights to access, correct, delete or export your personal data, and to object to or restrict processing.</p>
          <p><strong>Students and participants:</strong> please contact your institution, which controls your records; we will help them respond. <strong>Staff:</strong> you can update your profile in Account settings or contact us through the Support page.</p>
        </>
      ),
    },
    { id: 'children', title: 'Children', body: <p>Schools may use NTSAttend with students under the age of majority. In that case the school is responsible for obtaining any consent required by law (for example from parents or guardians) before requiring location checks or selfies.</p> },
    { id: 'cookies', title: 'Cookies and local storage', body: <p>We use one essential, secure, HttpOnly cookie to keep you signed in. Your theme choice (light or dark) is stored in your browser. We do not use advertising or tracking cookies.</p> },
    { id: 'changes', title: 'Changes and contact', body: <p>We will post updates on this page and change the date above. For questions, staff can contact us through the Support page in NTSAttend; students should contact their institution first.</p> },
  ];
  return (
    <LegalLayout
      title="Privacy Policy"
      intro="How NTSAttend collects, uses and protects information about staff, students and event participants."
      icon={<ShieldCheck className="h-6 w-6 text-cyan-200" />}
      sections={sections}
      other={{ to: '/terms', label: 'Terms of Service' }}
    />
  );
}

export function TermsPage() {
  const sections: Section[] = [
    { id: 'accept', title: 'Acceptance', body: <p>By creating an account or using NTSAttend you agree to these Terms and to our <Link to="/privacy" className="font-semibold text-brand-700">Privacy Policy</Link>. If you use NTSAttend on behalf of an institution, you confirm you are authorized to accept these Terms for it.</p> },
    {
      id: 'accounts', title: 'Accounts',
      body: (
        <ul>
          <li>Provide accurate information and keep your password and two-step verification codes confidential.</li>
          <li>You are responsible for activity under your account; tell us promptly about any unauthorized use.</li>
          <li>Students checking in through a QR code do not need an account.</li>
        </ul>
      ),
    },
    {
      id: 'institutions', title: 'Institutions’ responsibilities',
      body: (
        <ul>
          <li>Have a lawful basis for the student data you upload and the checks you require (location, selfie), and inform students how their data is used.</li>
          <li>Keep student records accurate and remove data you no longer need.</li>
          <li>Assign roles carefully: you control who in your organization can see attendance records and photos.</li>
        </ul>
      ),
    },
    {
      id: 'use', title: 'Acceptable use',
      body: (
        <>
          <p>You must not:</p>
          <ul>
            <li>record attendance for someone else, share QR codes to people who are not present, or falsify location;</li>
            <li>attempt to access another organization’s data, probe or bypass security controls, or overload the service;</li>
            <li>upload unlawful content or data you have no right to process.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'limits', title: 'How attendance verification works',
      body: <p>NTSAttend combines expiring QR codes, server-side location checks, student ID verification and optional selfies to make proxy attendance difficult. Browser location can be manipulated by a determined user and a selfie is not biometric identity verification, so records should be treated as strong evidence rather than proof. Institutions remain responsible for decisions based on attendance data.</p>,
    },
    { id: 'availability', title: 'Availability and changes', body: <p>We work to keep NTSAttend available and secure but do not guarantee uninterrupted service. We may change or improve features and will give reasonable notice of material changes to these Terms.</p> },
    { id: 'fees', title: 'Fees', body: <p>Pricing shown on our website is informational. Any paid plan will be agreed separately with your institution before charges apply.</p> },
    { id: 'ip', title: 'Intellectual property', body: <p>NTSAttend, its software and branding belong to NTS Digital Solutions. Institutions keep all rights to the data they upload and grant us permission to process it only to provide the service.</p> },
    {
      id: 'termination', title: 'Suspension and termination',
      body: <p>We may suspend accounts or organizations that breach these Terms or put the service or other users at risk. Institutions may stop using NTSAttend at any time and may request an export of their data before their organization is deactivated. After deactivation, data is deleted according to our retention practices.</p>,
    },
    { id: 'liability', title: 'Disclaimers and liability', body: <p>To the extent permitted by law, NTSAttend is provided “as is”, and NTS Digital Solutions is not liable for indirect or consequential losses. Nothing in these Terms limits liability that cannot be limited by law.</p> },
    { id: 'law', title: 'Governing law and contact', body: <p>These Terms are governed by the laws of the jurisdiction where NTS Digital Solutions is registered. Questions can be sent through the Support page in NTSAttend.</p> },
  ];
  return (
    <LegalLayout
      title="Terms of Service"
      intro="The rules for using NTSAttend — for institutions, staff and students who check in."
      icon={<FileText className="h-6 w-6 text-cyan-200" />}
      sections={sections}
      other={{ to: '/privacy', label: 'Privacy Policy' }}
    />
  );
}
