import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Building2, Calendar, GraduationCap, MailWarning, School, Sparkles, Users } from 'lucide-react';
import { errorMessage, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Input, Select, Textarea } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { ORG_TYPES, timeZones } from '@/utils/format';

const schema = z.object({
  type: z.string().min(1, 'Choose a type'),
  name: z.string().trim().min(2, 'Enter the organization name').max(150),
  officialEmail: z.string().email('Enter a valid email'),
  contactNumber: z.string().max(30).optional(),
  country: z.string().trim().min(2, 'Required').max(80),
  address: z.string().max(300).optional(),
  timezone: z.string().min(1),
  website: z.union([z.literal(''), z.string().url('Enter a full URL, e.g. https://example.edu')]).optional(),
  description: z.string().max(2000).optional(),
});
type Values = z.infer<typeof schema>;

const typeIcons: Record<string, React.ReactNode> = {
  UNIVERSITY: <GraduationCap className="h-6 w-6" />,
  COLLEGE: <Building2 className="h-6 w-6" />,
  SCHOOL: <School className="h-6 w-6" />,
  TRAINING_INSTITUTION: <Users className="h-6 w-6" />,
  EVENT_ORGANIZER: <Calendar className="h-6 w-6" />,
  OTHER: <Sparkles className="h-6 w-6" />,
};

export function OnboardingPage() {
  const { me, acceptSession } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { type: '', timezone: tz, officialEmail: me?.user.email ?? '' } });
  const type = form.watch('type');
  const e = form.formState.errors;

  if (me && !me.user.emailVerified) {
    return (
      <div className="bg-app flex min-h-screen items-center justify-center px-4">
        <div className="card max-w-md p-8 text-center">
          <MailWarning className="mx-auto mb-4 h-12 w-12 text-amber-500" />
          <h1 className="text-xl font-semibold">Verify your email first</h1>
          <p className="mt-2 text-sm text-slate-600">We sent a verification link to {me.user.email}. Open it to continue setting up your organization.</p>
          <Button
            variant="secondary"
            className="mt-6"
            onClick={() => post('/auth/resend-verification').then(() => toast.success('Verification email sent'), (err) => toast.error(errorMessage(err)))}
          >
            Resend email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-app min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Logo />
        <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-navy-900">Register your <span className="text-gradient">organization</span></h1>
        <p className="mt-1 text-sm text-slate-500">You’ll become its owner. Everything you configure applies only to your organization.</p>
        <ol className="mt-6 flex gap-2 text-xs font-medium" aria-label="Progress">
          {['Type', 'Details', 'Confirm'].map((s, i) => (
            <li key={s} className={clsx('flex-1 rounded-full px-3 py-1.5 text-center transition', step > i ? 'bg-gradient-to-r from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)]' : 'bg-white text-slate-400 ring-1 ring-slate-200')}>
              {s}
            </li>
          ))}
        </ol>
        <form
          className="glass animate-fade-up mt-6 rounded-3xl p-6 shadow-[0_24px_60px_-24px_rgb(11_31_77/0.3)] sm:p-8"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              const r = await post<{ accessToken: string }>('/organizations', { ...v, website: v.website || undefined });
              await acceptSession(r.accessToken);
              toast.success('Organization created');
              nav('/app/settings?tab=student-id');
            } catch (err) {
              toast.error(errorMessage(err));
            }
          })}
        >
          {step === 1 && (
            <div>
              <p className="mb-4 text-sm font-medium text-slate-700">What kind of organization is it?</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {ORG_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => form.setValue('type', t.value, { shouldValidate: true })}
                    className={clsx('flex flex-col items-center gap-2.5 rounded-2xl border-2 bg-white p-5 text-sm font-bold transition-all hover:-translate-y-0.5', type === t.value ? 'border-brand-500 bg-gradient-to-br from-brand-50 to-sky-50 text-brand-700 shadow-[var(--shadow-glow)]' : 'border-slate-100 text-slate-600 hover:border-brand-200 hover:shadow-md')}
                    aria-pressed={type === t.value}
                  >
                    {typeIcons[t.value]}
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <Button disabled={!type} onClick={() => setStep(2)}>
                  Continue
                </Button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input label="Organization name" error={e.name?.message} {...form.register('name')} />
              </div>
              <Input label="Official email" type="email" error={e.officialEmail?.message} {...form.register('officialEmail')} />
              <Input label="Contact number" type="tel" error={e.contactNumber?.message} {...form.register('contactNumber')} />
              <Input label="Country" error={e.country?.message} {...form.register('country')} />
              <Select label="Time zone" options={timeZones().map((z) => ({ value: z, label: z }))} {...form.register('timezone')} />
              <div className="sm:col-span-2">
                <Input label="Address" error={e.address?.message} {...form.register('address')} />
              </div>
              <div className="sm:col-span-2">
                <Input label="Website (optional)" error={e.website?.message} {...form.register('website')} />
              </div>
              <div className="sm:col-span-2">
                <Textarea label="Description (optional)" {...form.register('description')} />
              </div>
              <div className="flex justify-between sm:col-span-2">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button onClick={() => form.trigger().then((ok) => ok && setStep(3))}>Continue</Button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {(['name', 'type', 'officialEmail', 'country', 'timezone', 'contactNumber'] as const).map((k) => (
                  <div key={k}>
                    <dt className="text-xs text-slate-400">{k}</dt>
                    <dd className="font-medium text-slate-800">{form.getValues(k) || '—'}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">
                Next you’ll configure the student ID format, attendance rules and location settings. You can change them any time.
              </p>
              <div className="mt-6 flex justify-between">
                <Button variant="secondary" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button type="submit" loading={form.formState.isSubmitting}>
                  Create organization
                </Button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
