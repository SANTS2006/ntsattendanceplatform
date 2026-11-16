import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { appLink, renderEmail, type EmailContent } from '../../infra/emailTemplate.js';
import { enqueue } from '../../infra/queue.js';

/**
 * Queue an email (delivered by the `email` worker). Pass structured content to get the branded
 * NTSAttend template; HTML and plain text are rendered here so the job payload is self-contained.
 */
export const queueEmail = (to: string, subject: string, content: EmailContent) => {
  const { html, text } = renderEmail(content);
  return enqueue('email', { to, subject, text, html });
};

const CODE_TIP = 'NTSAttend staff will never ask you for this code. Do not share it with anyone, even if they say they work for your institution.';
const minutes = (n: number) => `${n} minutes`;

export const emails = {
  registrationCode: (to: string, name: string, code: string) =>
    queueEmail(to, `${code} is your NTSAttend verification code`, {
      preheader: `Your verification code is ${code}. It expires in 10 minutes.`,
      eyebrow: 'Verify your email',
      title: 'Confirm your email address',
      name,
      paragraphs: ['Welcome to NTSAttend! Enter this code on the sign-up page to verify your email and finish creating your account:'],
      code: { value: code, caption: `Expires in ${minutes(10)} · can be used once` },
      notes: ['If you did not try to sign up, you can ignore this email — no account has been created.'],
      securityTip: CODE_TIP,
      reason: `You received this email because someone started creating an NTSAttend account with ${to}.`,
    }),

  emailChangeCode: (to: string, name: string, code: string) =>
    queueEmail(to, `${code} is your NTSAttend email confirmation code`, {
      preheader: `Confirm your new sign-in email with code ${code}.`,
      eyebrow: 'Confirm new email',
      title: 'Confirm your new email address',
      name,
      paragraphs: ['Use this code in Account settings to confirm this address as your new NTSAttend sign-in email:'],
      code: { value: code, caption: `Expires in ${minutes(10)} · can be used once` },
      notes: ['If you did not request this change, ignore this email — your account email stays the same.'],
      securityTip: CODE_TIP,
      reason: `You received this email because ${to} was entered as a new sign-in email on an NTSAttend account.`,
    }),

  emailChangeAlert: (to: string, name: string, newEmail: string) =>
    queueEmail(to, 'An email change was requested on your NTSAttend account', {
      preheader: `A request was made to change your sign-in email to ${newEmail}.`,
      eyebrow: 'Account security',
      tone: 'security',
      title: 'Email change requested',
      name,
      paragraphs: ['A request was made to change the sign-in email on your NTSAttend account. It only takes effect after the code sent to the new address is confirmed.'],
      details: [['New email', newEmail], ['Requested', new Date().toUTCString()]],
      action: { label: 'This wasn’t me — reset my password', url: appLink('/forgot-password') },
      notes: ['If you made this request, no action is needed.'],
      reason: 'You received this security alert because you are the owner of this NTSAttend account.',
    }),

  emailChanged: (to: string, name: string, newEmail: string) =>
    queueEmail(to, 'Your NTSAttend email was changed', {
      preheader: `Your sign-in email is now ${newEmail}.`,
      eyebrow: 'Account security',
      tone: 'security',
      title: 'Your sign-in email was changed',
      name,
      paragraphs: ['Your NTSAttend sign-in email has been changed. This address will no longer receive account emails.'],
      details: [['New email', newEmail], ['Changed', new Date().toUTCString()]],
      notes: ['If you did not make this change, contact your organization administrator or NTSAttend support immediately.'],
      reason: 'You received this security alert because this address was the sign-in email of an NTSAttend account.',
    }),

  accountExists: (to: string) =>
    queueEmail(to, 'Your NTSAttend account', {
      preheader: 'Someone tried to sign up with your email, but you already have an account.',
      eyebrow: 'Sign-in help',
      title: 'You already have an account',
      paragraphs: ['Someone tried to create a new NTSAttend account with this email address, but an account already exists. Sign in instead, or reset your password if you have forgotten it.'],
      action: { label: 'Sign in to NTSAttend', url: appLink('/login') },
      notes: [`Forgot your password? Reset it here: ${appLink('/forgot-password')}`, 'If this wasn’t you, no action is needed — your account is unchanged.'],
      reason: `You received this email because someone tried to register ${to} on NTSAttend.`,
    }),

  verify: (to: string, name: string, token: string) =>
    queueEmail(to, 'Verify your NTSAttend email address', {
      preheader: 'Confirm your email address to finish setting up NTSAttend.',
      eyebrow: 'Verify your email',
      title: 'Confirm your email address',
      name,
      paragraphs: ['Confirm your email address to finish setting up your NTSAttend account.'],
      action: { label: 'Verify my email', url: appLink(`/verify-email?token=${token}`) },
      notes: ['This link expires in 24 hours. If you did not create an account, ignore this email.'],
      reason: `You received this email because ${to} was used to create an NTSAttend account.`,
    }),

  reset: (to: string, name: string, token: string) =>
    queueEmail(to, 'Reset your NTSAttend password', {
      preheader: 'Use this link within 30 minutes to choose a new password.',
      eyebrow: 'Password reset',
      tone: 'security',
      title: 'Reset your password',
      name,
      paragraphs: ['We received a request to reset the password for your NTSAttend account. Choose a new password with the button below.'],
      action: { label: 'Choose a new password', url: appLink(`/reset-password?token=${token}`) },
      notes: ['This link expires in 30 minutes and can be used once. After the reset you will be signed out on all devices.', 'If you did not request this, you can ignore this email — your password stays the same.'],
      securityTip: 'NTSAttend will never ask for your password by email, phone or chat.',
      reason: `You received this email because a password reset was requested for ${to}.`,
    }),

  invitation: (to: string, orgName: string, roleName: string, token: string) =>
    queueEmail(to, `You have been invited to ${orgName} on NTSAttend`, {
      preheader: `${orgName} invited you to join as ${roleName}.`,
      eyebrow: 'Invitation',
      tone: 'success',
      title: `Join ${orgName} on NTSAttend`,
      paragraphs: [`You have been invited to join ${orgName} on NTSAttend — the secure QR attendance platform your institution uses to run classes and events.`],
      details: [['Organization', orgName], ['Your role', roleName], ['Invitation expires', '7 days from now']],
      action: { label: 'Accept the invitation', url: appLink(`/accept-invitation?token=${token}`) },
      notes: ['If you were not expecting this invitation, you can ignore this email.'],
      reason: `You received this email because an administrator of ${orgName} invited ${to}.`,
    }),

  lecturerAccountCreated: (to: string, name: string, orgName: string, token: string) =>
    queueEmail(to, `Your ${orgName} lecturer account on NTSAttend`, {
      preheader: `${orgName} created an NTSAttend account for you. Set your password to start.`,
      eyebrow: 'Account created',
      tone: 'success',
      title: `Welcome to ${orgName} on NTSAttend`,
      name,
      paragraphs: [
        `${orgName} added you as a lecturer and created your NTSAttend account. Choose a password and confirm your details to start running QR attendance for your classes and events.`,
        'The account is yours: besides your work for this organization, you can create your own organization space from it at any time.',
      ],
      details: [['Organization', orgName], ['Your role', 'Lecturer'], ['Sign-in email', to], ['Link expires', '7 days from now']],
      action: { label: 'Set up my account', url: appLink(`/accept-invitation?token=${token}`) },
      notes: [
        'If the link has expired, ask your administrator to resend it, or use “Forgot password” on the sign-in page with this email.',
        'If you were not expecting this, you can ignore this email.',
      ],
      reason: `You received this email because an administrator of ${orgName} added ${to} as a lecturer.`,
    }),

  addedToOrganization: (to: string, name: string, orgName: string, roleName: string) =>
    queueEmail(to, `You were added to ${orgName} on NTSAttend`, {
      preheader: `${orgName} added you as ${roleName}. Sign in with your existing account.`,
      eyebrow: 'New organization',
      tone: 'success',
      title: `You now have access to ${orgName}`,
      name,
      paragraphs: [
        `${orgName} added you as ${roleName}. Sign in with your existing NTSAttend account and choose ${orgName} in the organization switcher.`,
        'Your own organizations and other memberships are unchanged.',
      ],
      details: [['Organization', orgName], ['Your role', roleName]],
      action: { label: 'Sign in to NTSAttend', url: appLink('/login') },
      notes: ['If you were not expecting this, contact the organization or NTSAttend support.'],
      reason: `You received this email because an administrator of ${orgName} added ${to}.`,
    }),

  supportReply: (to: string, name: string, subject: string, reply: string, ticketId: string) =>
    queueEmail(to, `Re: ${subject} — NTSAttend support`, {
      preheader: reply.slice(0, 120),
      eyebrow: 'Support',
      title: 'The NTSAttend team replied',
      name,
      paragraphs: [`We replied to your request “${subject}”.`],
      quote: { from: 'NTSAttend support', text: reply.slice(0, 1500) },
      action: { label: 'View the conversation', url: appLink(`/app/support?ticket=${ticketId}`) },
      notes: ['Reply from the Help & support page in NTSAttend — replies to this email are not monitored.'],
      reason: 'You received this email because you opened a support request for your organization.',
    }),

  securityAlert: (to: string, text: string) =>
    queueEmail(to, 'NTSAttend security alert', {
      preheader: text.slice(0, 120),
      eyebrow: 'Account security',
      tone: 'security',
      title: 'Security alert',
      paragraphs: text.split(/\n{2,}/),
      action: { label: 'Review my account', url: appLink('/app/account?tab=sessions') },
      reason: 'You received this security alert because it concerns your NTSAttend account.',
    }),
};

/** In-app notification (and optional email). */
export async function notifyUser(input: {
  userId: string;
  organizationId?: string | null;
  type: string;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
}) {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      organizationId: input.organizationId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
    },
  });
}
