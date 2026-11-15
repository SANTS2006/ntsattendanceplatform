import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { UseFormRegisterReturn } from 'react-hook-form';
import clsx from 'clsx';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Mail, MailCheck, Phone, RefreshCw, ShieldCheck, User } from 'lucide-react';
import { ApiError, errorMessage, get, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { LogoSpinner } from '@/components/brand';
import { Button, Input, BackButton } from '@/components/ui';
import { AuthShell } from './AuthShell';
import { CodeInput, PasswordInput, StrengthMeter } from './fields';
import { GoogleButton, useAuthConfig } from './GoogleButton';

const password = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and numbers');

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/app');

function applyServerErrors(e: unknown, setError: (k: never, v: { message: string }) => void) {
  if (e instanceof ApiError && e.code === 'VALIDATION_ERROR') {
    for (const [k, v] of Object.entries(e.errors)) setError(k as never, { message: Array.isArray(v) ? String(v[0]) : String(v) });
  }
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="animate-fade-up rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-medium text-rose-700" role="alert">
      {message}
    </p>
  );
}

/* ── Legal agreement ───────────────────────────────────────────────────────── */

function AgreeCheckbox({ register, error }: { register: UseFormRegisterReturn; error?: string }) {
  return (
    <div>
      <label className={clsx('flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition', error ? 'border-rose-300 bg-rose-50/60' : 'border-slate-200 bg-slate-50/60 hover:border-brand-200')}>
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded-md border-slate-300 accent-brand-600" aria-invalid={!!error} {...register} />
        <span className="text-sm leading-relaxed text-slate-600">
          I agree to the{' '}
          <Link to="/terms" target="_blank" rel="noopener" className="font-semibold text-brand-700 hover:text-brand-600">Terms of Service</Link>{' '}
          and{' '}
          <Link to="/privacy" target="_blank" rel="noopener" className="font-semibold text-brand-700 hover:text-brand-600">Privacy Policy</Link>
          , including how student attendance data, locations and photos are processed.
        </span>
      </label>
      {error && <p className="animate-fade-up mt-1.5 text-xs font-medium text-rose-600" role="alert">{error}</p>}
    </div>
  );
}

/** Blocks the Google sign-up button until the terms box is ticked. */
function GoogleTermsNote() {
  const cfg = useAuthConfig();
  if (!cfg.data?.googleClientId) return null;
  return (
    <p className="-mt-2 text-center text-xs text-slate-400">
      By continuing with Google you agree to the <Link to="/terms" className="font-semibold text-slate-500 hover:text-brand-600">Terms</Link> and{' '}
      <Link to="/privacy" className="font-semibold text-slate-500 hover:text-brand-600">Privacy Policy</Link>.
    </p>
  );
}

/* ── Sign in ─────────────────────────────────────────────────────────────── */

function MfaStep({ mfaToken, onBack }: { mfaToken: string; onBack: () => void }) {
  const { completeMfa } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (c = code) => {
    setBusy(true);
    setError(null);
    try {
      await completeMfa(mfaToken, c);
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Two-step verification" subtitle="Enter the 6-digit code from your authenticator app.">
      <div className="mb-6 flex justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)]">
          <ShieldCheck className="h-7 w-7" />
        </span>
      </div>
      <div className="space-y-5">
        <CodeInput value={code} onChange={(v) => {
          const digits = v.replace(/\D/g, '');
          setCode(digits);
          if (digits.length === 6) void submit(digits);
        }} invalid={!!error} disabled={busy} />
        <FormError message={error} />
        <Button className="w-full" size="lg" loading={busy} disabled={code.length !== 6} onClick={() => submit()}>
          Verify and sign in
        </Button>
        <BackButton className="mx-auto flex" onClick={onBack} label="Back to sign in" />
      </div>
    </AuthShell>
  );
}

export function LoginPage() {
  const { login, status } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = safeNext(sp.get('next'));
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string; password: string }>({
    resolver: zodResolver(z.object({ email: z.string().email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') })),
  });

  useEffect(() => {
    if (status === 'authenticated') nav(next, { replace: true });
  }, [status, nav, next]);

  if (mfaToken) return <MfaStep mfaToken={mfaToken} onBack={() => setMfaToken(null)} />;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to run attendance and see who’s really in the room."
      footer={
        <>
          New to NTSAttend?{' '}
          <Link to="/register" className="font-bold text-brand-700 ">
            Create a free account
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <GoogleButton mode="signin" onMfa={setMfaToken} onSuccess={() => toast.success('Signed in with Google')} />
        <GoogleTermsNote />
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit(async (v) => {
            setError(null);
            try {
              const r = await login(v.email, v.password);
              if (r.mfaRequired) setMfaToken(r.mfaToken);
            } catch (e) {
              setError(errorMessage(e));
            }
          })}
        >
          <FormError message={error} />
          <Input label="Email address" type="email" autoComplete="email" icon={<Mail />} error={form.formState.errors.email?.message} {...form.register('email')} />
          <div>
            <PasswordInput label="Password" autoComplete="current-password" error={form.formState.errors.password?.message} {...form.register('password')} />
            <div className="mt-2 flex justify-end">
              <Link to="/forgot-password" className="text-sm font-semibold text-brand-700 ">
                Forgot password?
              </Link>
            </div>
          </div>
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting} icon={<ArrowRight className="h-5 w-5" />}>
            {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}

/* ── Register (step 1: details → step 2: emailed code) ─────────────────────── */

const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Required').max(80),
    lastName: z.string().trim().min(1, 'Required').max(80),
    email: z.string().email('Enter a valid email address'),
    phone: z.string().trim().max(30).optional(),
    password,
    confirm: z.string().min(1, 'Confirm your password'),
    agree: z.boolean().refine((v) => v, 'You must agree to the Terms of Service and Privacy Policy'),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function Steps({ step }: { step: 1 | 2 }) {
  return (
    <ol className="mb-6 flex items-center gap-2 text-xs font-bold" aria-label="Sign-up progress">
      {['Your details', 'Verify email'].map((label, i) => {
        const n = (i + 1) as 1 | 2;
        const done = step > n;
        const current = step === n;
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={current ? 'step' : undefined}>
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
                done ? 'bg-check text-white' : current ? 'bg-gradient-to-br from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)]' : 'bg-slate-200 text-slate-500'
              }`}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : n}
            </span>
            <span className={current ? 'text-navy-900' : 'text-slate-400'}>{label}</span>
            {i === 0 && <span className={`h-0.5 flex-1 rounded-full ${step > 1 ? 'bg-check' : 'bg-slate-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

function VerifyCodeStep({ email, onBack }: { email: string; onBack: () => void }) {
  const { acceptSession } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = async (c = code) => {
    if (c.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ accessToken: string }>('/auth/register/verify', { email, code: c });
      setVerified(true);
      await new Promise((res) => setTimeout(res, 900)); // let the success animation play
      await acceptSession(r.accessToken);
      toast.success('Email verified — welcome to NTSAttend!');
      nav('/onboarding');
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && (err.code === 'TOO_MANY_ATTEMPTS' || err.code === 'CODE_EXPIRED')) setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await post('/auth/register/resend', { email });
      toast.success('A new code is on its way');
      setCooldown(60);
      setCode('');
      setError(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <AuthShell title="Check your email" subtitle={<>We sent a 6-character code to <span className="font-semibold text-navy-800">{email}</span>. It expires in 10 minutes.</>}>
      <Steps step={verified ? 2 : 2} />
      {verified ? (
        <div className="animate-pop flex flex-col items-center py-6 text-center">
          <span className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/60">
            <CheckCircle2 className="h-12 w-12 text-check" />
          </span>
          <p className="text-lg font-extrabold text-navy-900">Email verified</p>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            <LogoSpinner size="xs" /> Creating your account…
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)]">
              <MailCheck className="h-7 w-7" />
            </span>
          </div>
          <CodeInput
            value={code}
            invalid={!!error}
            disabled={busy}
            onChange={(v) => {
              setCode(v);
              setError(null);
              if (v.length === 6) void verify(v);
            }}
          />
          <FormError message={error} />
          <Button size="lg" className="w-full" loading={busy} disabled={code.length !== 6} onClick={() => verify()}>
            Verify & create account
          </Button>
          <div className="flex items-center justify-between text-sm">
            <BackButton onClick={onBack} label="Use a different email" />
            <button className="flex items-center gap-1 font-semibold text-brand-700 disabled:text-slate-400" onClick={resend} disabled={cooldown > 0}>
              <RefreshCw className="h-4 w-4" /> {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
          <p className="text-center text-xs text-slate-400">Can’t find it? Check spam or promotions. Codes use letters and numbers, without 0, O, 1 or I.</p>
        </div>
      )}
    </AuthShell>
  );
}

export function RegisterPage() {
  const nav = useNavigate();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const form = useForm<z.infer<typeof registerSchema>>({ resolver: zodResolver(registerSchema) });
  const e = form.formState.errors;
  const pw = form.watch('password') ?? '';

  if (mfaToken) return <MfaStep mfaToken={mfaToken} onBack={() => setMfaToken(null)} />;
  if (pendingEmail) return <VerifyCodeStep email={pendingEmail} onBack={() => setPendingEmail(null)} />;

  return (
    <AuthShell
      wide
      title="Create your account"
      subtitle="Set up NTSAttend for your institution in minutes. Students never need an account."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-brand-700 ">
            Sign in
          </Link>
        </>
      }
    >
      <Steps step={1} />
      <div className="space-y-5">
        <div className="relative">
          <GoogleButton mode="signup" onMfa={setMfaToken} onSuccess={(created) => { toast.success(created ? 'Account created with Google' : 'Signed in with Google'); nav('/onboarding'); }} />
        </div>
        <GoogleTermsNote />
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit(async ({ confirm: _c, agree, phone, ...v }) => {
            setError(null);
            try {
              await post('/auth/register', { ...v, phone: phone || undefined, acceptTerms: agree });
              setPendingEmail(v.email.toLowerCase());
            } catch (err) {
              applyServerErrors(err, form.setError as never);
              setError(errorMessage(err));
            }
          })}
        >
          <FormError message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First name" autoComplete="given-name" icon={<User />} error={e.firstName?.message} {...form.register('firstName')} />
            <Input label="Last name" autoComplete="family-name" icon={<User />} error={e.lastName?.message} {...form.register('lastName')} />
          </div>
          <Input label="Work email" type="email" autoComplete="email" icon={<Mail />} error={e.email?.message} {...form.register('email')} />
          <Input label="Phone (optional)" type="tel" autoComplete="tel" icon={<Phone />} {...form.register('phone')} />
          <PasswordInput label="Password" autoComplete="new-password" error={e.password?.message} {...form.register('password')} />
          <StrengthMeter password={pw} />
          <PasswordInput label="Confirm password" autoComplete="new-password" error={e.confirm?.message} {...form.register('confirm')} />
          <AgreeCheckbox register={form.register('agree')} error={e.agree?.message} />
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting} icon={<ArrowRight className="h-5 w-5" />}>
            {form.formState.isSubmitting ? 'Sending code…' : 'Continue'}
          </Button>
          <p className="text-center text-xs text-slate-400">We’ll email you a 6-character code. Your account is created only after you verify it.</p>
        </form>
      </div>
    </AuthShell>
  );
}

/* ── Legacy link-based email verification (accounts created before codes) ─── */

export function VerifyEmailPage() {
  const [sp] = useSearchParams();
  const { reload, status } = useAuth();
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [msg, setMsg] = useState('');
  const started = useRef(false); // single-use token: never submit it twice (StrictMode, re-renders)
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = sp.get('token');
    if (!token) {
      setState('error');
      setMsg('This verification link is incomplete.');
      return;
    }
    post('/auth/verify-email', { token })
      .then(() => {
        setState('ok');
        if (status === 'authenticated') void reload();
      })
      .catch((e) => {
        setState('error');
        setMsg(errorMessage(e));
      });
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AuthShell title="Email verification">
      {state === 'pending' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <LogoSpinner size="md" />
          <p className="text-sm text-slate-500">Verifying…</p>
        </div>
      )}
      {state === 'ok' && (
        <div className="animate-pop text-center">
          <CheckCircle2 className="mx-auto mb-3 h-14 w-14 text-check" />
          <p className="text-slate-700">Your email address is verified.</p>
          <Link to="/onboarding" className="mt-4 inline-block font-bold text-brand-700">
            Continue →
          </Link>
        </div>
      )}
      {state === 'error' && <FormError message={msg} />}
    </AuthShell>
  );
}

/* ── Password reset ─────────────────────────────────────────────────────────── */

export function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().email('Enter a valid email address') })) });
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your account email and we’ll send you a secure reset link."
      footer={<Link to="/login" className="inline-flex items-center gap-1 font-bold text-brand-700"><ArrowLeft className="h-4 w-4" /> Back to sign in</Link>}
    >
      {sent ? (
        <div className="animate-pop text-center">
          <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)]">
            <MailCheck className="h-8 w-8" />
          </span>
          <p className="text-sm text-slate-600">
            If an account exists for <span className="font-semibold">{sent}</span>, a reset link is on its way. It expires in 30 minutes.
          </p>
        </div>
      ) : (
        <form
          className="space-y-5"
          noValidate
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await post('/auth/forgot-password', v);
              setSent(v.email);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          })}
        >
          <Input label="Email address" type="email" autoComplete="email" icon={<Mail />} error={form.formState.errors.email?.message} {...form.register('email')} />
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const schema = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const pw = form.watch('password') ?? '';
  return (
    <AuthShell title="Choose a new password" subtitle="All your other devices will be signed out.">
      <form
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          try {
            await post('/auth/reset-password', { token: sp.get('token'), password: v.password });
            toast.success('Password updated. Please sign in.');
            nav('/login');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        })}
      >
        <PasswordInput label="New password" autoComplete="new-password" error={form.formState.errors.password?.message} {...form.register('password')} />
        <StrengthMeter password={pw} />
        <PasswordInput label="Confirm password" autoComplete="new-password" error={form.formState.errors.confirm?.message} {...form.register('confirm')} />
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting} icon={<KeyRound className="h-5 w-5" />}>
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}

/* ── Invitations ─────────────────────────────────────────────────────────────── */

type InvitationInfo = { organizationName: string; email: string; roleName: string; expiresAt: string; accountExists: boolean };

export function AcceptInvitationPage() {
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const { status, me, acceptSession } = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({ firstName: z.string().trim().min(1, 'Required'), lastName: z.string().trim().min(1, 'Required'), password });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const pw = form.watch('password') ?? '';
  useEffect(() => {
    get<InvitationInfo>('/invitations/lookup', { token }).then(setInfo, (e) => setError(errorMessage(e)));
  }, [token]);

  const accept = async (body: Record<string, unknown> = {}) => {
    try {
      const r = await post<{ accessToken: string }>('/invitations/accept', { token, ...body });
      await acceptSession(r.accessToken);
      toast.success(`Welcome to ${info?.organizationName}`);
      nav('/app');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (error) return <AuthShell title="Invitation"><FormError message={error} /></AuthShell>;
  if (!info) {
    return (
      <AuthShell title="Invitation">
        <div className="flex justify-center py-8"><LogoSpinner size="md" /></div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Join ${info.organizationName}`} subtitle={<>You were invited as <span className="font-semibold text-navy-800">{info.roleName}</span> ({info.email}).</>}>
      {info.accountExists ? (
        status === 'authenticated' && me?.user.email === info.email ? (
          <Button size="lg" className="w-full" onClick={() => accept()}>
            Accept invitation
          </Button>
        ) : (
          <div className="space-y-3 text-sm text-slate-600">
            <p>Sign in as {info.email} to accept this invitation.</p>
            <Link to={`/login?next=${encodeURIComponent(`/accept-invitation?token=${token}`)}`}>
              <Button className="w-full">Sign in to accept</Button>
            </Link>
          </div>
        )
      ) : (
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => accept(v))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First name" icon={<User />} error={form.formState.errors.firstName?.message} {...form.register('firstName')} />
            <Input label="Last name" icon={<User />} error={form.formState.errors.lastName?.message} {...form.register('lastName')} />
          </div>
          <PasswordInput label="Create a password" autoComplete="new-password" error={form.formState.errors.password?.message} {...form.register('password')} />
          <StrengthMeter password={pw} />
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            Create account & join
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
