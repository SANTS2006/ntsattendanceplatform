import { useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { Camera, Mail, MailCheck, Phone, RotateCw, ShieldCheck, Trash2, User as UserIcon, X } from 'lucide-react';
import { del, errorMessage, get, http, patch, post, type ApiSuccess } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, DataTable, Input, Modal, PageHeader, Tabs } from '@/components/ui';
import { Avatar, useRoleLabel } from '@/components/UserCard';
import { CodeInput, PasswordInput, StrengthMeter } from '@/features/auth/fields';
import { codeField, emailField, passwordField, phoneField, req, totpField } from '@/lib/validation';
import { ThemeSegmented } from '@/theme/ThemeProvider';
import { displayName, fmtDateTime } from '@/utils/format';
import { ImageViewer } from '@/components/ImageViewer';

export function AccountPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'profile';
  // The old notifications tab is now a page of its own.
  if (tab === 'notifications') return <Navigate to="../notifications" relative="path" replace />;
  return (
    <div>
      <PageHeader title="Account & security" description="Manage your profile, sign-in methods and devices." />
      <Tabs tabs={[{ key: 'profile', label: 'Profile' }, { key: 'security', label: 'Password & MFA' }, { key: 'sessions', label: 'Devices' }]} active={tab} onChange={(k) => setSp({ tab: k })} />
      {tab === 'profile' && <Profile />}
      {tab === 'security' && <Security />}
      {tab === 'sessions' && <Sessions />}
    </div>
  );
}

/* ── Profile ─────────────────────────────────────────────────────────────── */

const MAX_AVATAR = 5 * 1024 * 1024;

function AvatarCard() {
  const { me, reload } = useAuth();
  const role = useRoleLabel(me?.activeOrganizationId ? 'org' : 'platform');
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  /** Local preview of the chosen image while it uploads. */
  const [preview, setPreview] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const fullName = displayName(me?.user.firstName, me?.user.lastName);

  const remove = async () => {
    setBusy('remove');
    try {
      await del('/auth/me/avatar');
      await reload();
      setViewing(false);
      toast.success('Profile picture removed');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast.error('Choose a JPEG, PNG or WebP image');
    if (file.size > MAX_AVATAR) return toast.error('The image must be 5 MB or smaller');
    const fd = new FormData();
    fd.append('file', file);
    const url = URL.createObjectURL(file);
    setPreview(url);
    setBusy('upload');
    try {
      await http.post<ApiSuccess<unknown>>('/auth/me/avatar', fd);
      await reload();
      toast.success('Profile picture updated');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
      setPreview(null);
      URL.revokeObjectURL(url);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Card className="h-fit overflow-hidden" padded={false}>
      <div className="bg-hero h-20" />
      <div className="-mt-12 flex flex-col items-center px-6 pb-6 text-center">
        <div className="relative">
          <button
            type="button"
            onClick={() => (me?.user.avatarUrl || preview ? setViewing(true) : fileRef.current?.click())}
            className="block rounded-full transition hover:brightness-95 focus-visible:ring-4 focus-visible:ring-brand-300 focus-visible:outline-none"
            aria-label={me?.user.avatarUrl ? 'View profile picture' : 'Upload a profile picture'}
            title={me?.user.avatarUrl ? 'View larger' : 'Upload a photo'}
          >
            {preview ? (
              <img src={preview} alt="" className="h-24 w-24 rounded-full object-cover ring-4 ring-white" />
            ) : (
              <Avatar size="lg" className="!h-24 !w-24 cursor-zoom-in !text-2xl ring-4 !ring-white" />
            )}
          </button>
          {busy === 'upload' && (
            <span className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-navy-950/55 text-white backdrop-blur-[1px]" role="status" aria-live="polite">
              <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
              <span className="mt-1 text-[10px] font-bold tracking-wider uppercase">Uploading</span>
            </span>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            className="absolute right-0 bottom-0 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-cyan-brand text-white shadow-lg ring-4 ring-white transition hover:brightness-110 disabled:opacity-60"
            aria-label="Upload a new profile picture"
          >
            {busy === 'upload' ? <RotateCw className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
        <p className="mt-3 text-lg font-extrabold text-navy-900">{fullName}</p>
        <p className="text-sm break-all text-slate-500">{me?.user.email}</p>
        <span className="mt-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{role}</span>
        <div className="mt-5 flex w-full flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
          <Button className="flex-1" variant="secondary" icon={<Camera className="h-4 w-4" />} onClick={() => fileRef.current?.click()} loading={busy === 'upload'}>
            {me?.user.avatarUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          {me?.user.avatarUrl && (
            <Button
              className="flex-1"
              variant="ghost"
              icon={<Trash2 className="h-4 w-4" />}
              loading={busy === 'remove'}
              onClick={remove}
            >
              Remove
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-400">JPEG, PNG or WebP · up to 5 MB</p>
        <div className="mt-5 w-full border-t border-slate-100 pt-4 text-left">
          <p className="mb-2 text-xs font-bold tracking-wider text-slate-400 uppercase">Appearance</p>
          <ThemeSegmented />
        </div>
      </div>
      <ImageViewer
        open={viewing}
        onClose={() => setViewing(false)}
        src={preview ?? me?.user.avatarUrl}
        alt={`${fullName} profile picture`}
        title={fullName}
        subtitle="Profile picture"
        rounded
        busy={busy}
        changeLabel="Change photo"
        onChange={(f) => void upload(f)}
        onRemove={me?.user.avatarUrl ? () => void remove() : undefined}
      />
    </Card>
  );
}

const profileSchema = z.object({ firstName: req('first name', 80), lastName: req('last name', 80), phone: phoneField });

function DetailsCard() {
  const { me, reload } = useAuth();
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: { firstName: me?.user.firstName ?? '', lastName: me?.user.lastName ?? '', phone: me?.user.phone ?? '' },
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  return (
    <Card title="Personal details" icon={<UserIcon className="h-5 w-5" />}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (v) => {
          try {
            await patch('/auth/me', { firstName: v.firstName, lastName: v.lastName, phone: v.phone || null });
            await reload();
            toast.success('Profile saved');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name *" autoComplete="given-name" error={errors.firstName?.message} {...form.register('firstName')} />
          <Input label="Last name *" autoComplete="family-name" error={errors.lastName?.message} {...form.register('lastName')} />
        </div>
        <Input label="Phone number (optional)" type="tel" autoComplete="tel" icon={<Phone />} error={errors.phone?.message} {...form.register('phone')} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={!isDirty} onClick={() => form.reset()}>Discard</Button>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save changes</Button>
        </div>
      </form>
    </Card>
  );
}

function EmailCard() {
  const { me, reload } = useAuth();
  const pending = me?.pendingEmailChange ?? null;
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const schema = z.object({
    newEmail: emailField.refine((v) => v.toLowerCase() !== me?.user.email.toLowerCase(), 'This is already your email address'),
    password: me?.user.hasPassword ? z.string().min(1, 'Enter your current password') : z.string().optional(),
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { newEmail: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const verify = useMutation({
    mutationFn: () => post('/auth/email-change/verify', { code }),
    onSuccess: async () => { setCode(''); await reload(); toast.success('Email address updated'); },
    onError: (e) => setCodeError(errorMessage(e)),
  });
  const resend = useMutation({ mutationFn: () => post('/auth/email-change/resend'), onSuccess: () => toast.success('A new code has been sent'), onError: (e) => toast.error(errorMessage(e)) });
  const cancel = useMutation({ mutationFn: () => del('/auth/email-change'), onSuccess: async () => { setCode(''); await reload(); toast.success('Email change cancelled'); } });

  return (
    <Card title="Email address" icon={<Mail className="h-5 w-5" />}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-400">Current email</p>
          <p className="truncate text-sm font-bold text-navy-900">{me?.user.email}</p>
        </div>
        {me?.user.emailVerified ? <Badge tone="ACTIVE">Verified</Badge> : <Badge tone="PENDING">Not verified</Badge>}
      </div>

      {pending ? (
        <div className="mt-5 space-y-4 rounded-2xl border border-brand-100 bg-brand-50/40 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <p className="text-sm text-slate-600">
              We sent a 6-character code to <strong className="break-all text-navy-900">{pending.newEmail}</strong>. Enter it below to confirm your new email. The code expires at {fmtDateTime(pending.expiresAt)}.
            </p>
          </div>
          <CodeInput value={code} invalid={!!codeError} onChange={(v) => { setCode(v); setCodeError(undefined); }} />
          {codeError && <p className="text-center text-sm text-rose-600">{codeError}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" icon={<X className="h-4 w-4" />} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel change</Button>
            <Button variant="secondary" icon={<RotateCw className="h-4 w-4" />} loading={resend.isPending} onClick={() => resend.mutate()}>Resend code</Button>
            <Button
              loading={verify.isPending}
              onClick={() => {
                const r = codeField.safeParse(code.trim());
                if (!r.success) return setCodeError(r.error.issues[0].message);
                verify.mutate();
              }}
            >
              Verify new email
            </Button>
          </div>
        </div>
      ) : editing ? (
        <form
          noValidate
          className="mt-5 space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await post('/auth/email-change', { newEmail: v.newEmail, ...(me?.user.hasPassword ? { password: v.password } : {}) });
              form.reset();
              setEditing(false);
              await reload();
              toast.success('Check your new inbox for a 6-character code');
            } catch (e) {
              toast.error(errorMessage(e));
            }
          })}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="New email address" type="email" autoComplete="email" icon={<Mail />} error={errors.newEmail?.message} {...form.register('newEmail')} />
            {me?.user.hasPassword && <PasswordInput label="Current password" autoComplete="current-password" error={errors.password?.message} {...form.register('password')} />}
          </div>
          <p className="text-xs text-slate-500">We’ll email a verification code to the new address and let your current address know about the change.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => { setEditing(false); form.reset(); }}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>Send verification code</Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={() => setEditing(true)}>Change email</Button>
        </div>
      )}
    </Card>
  );
}

function Profile() {
  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <AvatarCard />
      <div className="min-w-0 space-y-6">
        <DetailsCard />
        <EmailCard />
      </div>
    </div>
  );
}

/* ── Security ────────────────────────────────────────────────────────────── */

const pwSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordField, confirm: z.string().min(1, 'Confirm your new password') })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a password different from your current one' });

const disableSchema = z.object({ password: z.string().min(1, 'Enter your password'), code: totpField });

function Security() {
  const { me, reload } = useAuth();
  const pw = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const dis = useForm<z.infer<typeof disableSchema>>({ resolver: zodResolver(disableSchema), defaultValues: { password: '', code: '' } });
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  const [disableOpen, setDisableOpen] = useState(false);
  const newPw = pw.watch('newPassword');
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Change password" icon={<ShieldCheck className="h-5 w-5" />}>
        {me?.user.hasPassword === false ? (
          <p className="text-sm text-slate-600">You sign in with Google. Use “Forgot password” on the sign-in page to add a password.</p>
        ) : (
          <form noValidate className="space-y-4" onSubmit={pw.handleSubmit(async (v) => { try { await post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }); pw.reset(); toast.success('Password changed. Other devices were signed out.'); } catch (e) { toast.error(errorMessage(e)); } })}>
            <PasswordInput label="Current password" autoComplete="current-password" error={pw.formState.errors.currentPassword?.message} {...pw.register('currentPassword')} />
            <PasswordInput label="New password" autoComplete="new-password" hint="At least 10 characters with letters and numbers" error={pw.formState.errors.newPassword?.message} {...pw.register('newPassword')} />
            <StrengthMeter password={newPw} />
            <PasswordInput label="Confirm new password" autoComplete="new-password" error={pw.formState.errors.confirm?.message} {...pw.register('confirm')} />
            <div className="flex justify-end"><Button type="submit" loading={pw.formState.isSubmitting}>Update password</Button></div>
          </form>
        )}
      </Card>
      <Card title="Two-step verification (TOTP)">
        {me?.user.mfaEnabled ? (
          <div className="space-y-3">
            <Badge tone="ACTIVE">Enabled</Badge>
            <p className="text-sm text-slate-600">A code from your authenticator app is required at sign-in.</p>
            <Button variant="secondary" onClick={() => setDisableOpen(true)}>Disable</Button>
          </div>
        ) : setup ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Scan this with Google Authenticator, Microsoft Authenticator, 1Password or similar, then enter the 6-digit code.</p>
            <div className="flex justify-center"><div className="rounded-2xl bg-white p-3"><QRCodeSVG value={setup.otpauthUri} size={180} /></div></div>
            <p className="text-center font-mono text-xs break-all text-slate-500">{setup.secret}</p>
            <Input label="Verification code" inputMode="numeric" maxLength={6} value={code} error={codeError} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setCodeError(undefined); }} />
            <Button
              onClick={async () => {
                const r = totpField.safeParse(code);
                if (!r.success) return setCodeError(r.error.issues[0].message);
                try { await post('/auth/mfa/enable', { code }); setSetup(null); setCode(''); await reload(); toast.success('Two-step verification enabled'); } catch (e) { setCodeError(errorMessage(e)); }
              }}
            >
              Enable
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Protect your account with a time-based code from an authenticator app.</p>
            <Button onClick={async () => { try { setSetup(await post('/auth/mfa/setup')); } catch (e) { toast.error(errorMessage(e)); } }}>Set up</Button>
          </div>
        )}
      </Card>
      <Modal
        open={disableOpen}
        onClose={() => { setDisableOpen(false); dis.reset(); }}
        title="Disable two-step verification"
        size="sm"
        footer={
          <Button
            variant="danger"
            loading={dis.formState.isSubmitting}
            onClick={dis.handleSubmit(async (v) => { try { await post('/auth/mfa/disable', v); setDisableOpen(false); dis.reset(); await reload(); toast.success('Two-step verification disabled'); } catch (e) { toast.error(errorMessage(e)); } })}
          >
            Disable
          </Button>
        }
      >
        <div className="space-y-3">
          <PasswordInput label="Password" autoComplete="current-password" error={dis.formState.errors.password?.message} {...dis.register('password')} />
          <Input label="Current code" inputMode="numeric" maxLength={6} error={dis.formState.errors.code?.message} {...dis.register('code')} />
        </div>
      </Modal>
    </div>
  );
}

/* ── Devices ─────────────────────────────────────────────────────────────── */

type Device = { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastUsedAt: string; current: boolean };

function Sessions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['devices'], queryFn: () => get<Device[]>('/auth/sessions') });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/auth/sessions/${id}`), onSuccess: () => { toast.success('Device signed out'); qc.invalidateQueries({ queryKey: ['devices'] }); } });
  return (
    <Card padded={false} title="Signed-in devices">
      <DataTable rows={q.data} loading={q.isLoading} columns={[
        { key: 'ua', header: 'Device', render: (d) => <span className="text-xs whitespace-normal">{d.userAgent ?? 'Unknown'}</span> },
        { key: 'ip', header: 'IP', render: (d) => d.ip ?? '—' },
        { key: 'l', header: 'Last active', render: (d) => fmtDateTime(d.lastUsedAt) },
        { key: 'c', header: '', render: (d) => (d.current ? <Badge tone="ACTIVE">This device</Badge> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(d.id)}>Sign out</Button>) },
      ]} />
    </Card>
  );
}
