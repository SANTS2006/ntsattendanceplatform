import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { enqueue } from '../../infra/queue.js';

/** Queue an email (delivered by the `email` worker). */
export const queueEmail = (to: string, subject: string, text: string) => enqueue('email', { to, subject, text });

export const emails = {
  registrationCode: (to: string, name: string, code: string) =>
    queueEmail(
      to,
      `${code} is your NTSAttend verification code`,
      `Hello ${name},\n\nUse this code to verify your email and finish creating your NTSAttend account:\n\n    ${code}\n\nThe code expires in 10 minutes. If you did not try to sign up, you can ignore this email — no account has been created.`,
    ),
  emailChangeCode: (to: string, name: string, code: string) =>
    queueEmail(
      to,
      `${code} is your NTSAttend email confirmation code`,
      `Hello ${name},\n\nUse this code to confirm this address as your new NTSAttend sign-in email:\n\n    ${code}\n\nThe code expires in 10 minutes. If you did not request this change, ignore this email.`,
    ),
  emailChangeAlert: (to: string, name: string, newEmail: string) =>
    queueEmail(
      to,
      'An email change was requested on your NTSAttend account',
      `Hello ${name},\n\nA request was made to change your NTSAttend sign-in email to ${newEmail}. It only takes effect after a code sent to that address is confirmed.\n\nIf this was not you, reset your password now:\n${env.APP_URL}/forgot-password`,
    ),
  emailChanged: (to: string, name: string, newEmail: string) =>
    queueEmail(
      to,
      'Your NTSAttend email was changed',
      `Hello ${name},\n\nYour NTSAttend sign-in email is now ${newEmail}. This address will no longer receive account emails.\n\nIf you did not make this change, contact your organization administrator immediately.`,
    ),
  accountExists: (to: string) =>
    queueEmail(
      to,
      'Your NTSAttend account',
      `Someone tried to create a new NTSAttend account with this email address, but an account already exists.\n\nSign in: ${env.APP_URL}/login\nForgot your password? ${env.APP_URL}/forgot-password\n\nIf this wasn't you, no action is needed.`,
    ),
  verify: (to: string, name: string, token: string) =>
    queueEmail(
      to,
      'Verify your NTSAttend email address',
      `Hello ${name},\n\nConfirm your email address to finish setting up your NTS account:\n${env.APP_URL}/verify-email?token=${token}\n\nThis link expires in 24 hours. If you did not create an account, ignore this email.`,
    ),
  reset: (to: string, name: string, token: string) =>
    queueEmail(
      to,
      'Reset your NTSAttend password',
      `Hello ${name},\n\nA password reset was requested for your account:\n${env.APP_URL}/reset-password?token=${token}\n\nThis link expires in 30 minutes and can be used once. If you did not request this, you can ignore this email.`,
    ),
  invitation: (to: string, orgName: string, roleName: string, token: string) =>
    queueEmail(
      to,
      `You have been invited to ${orgName} on NTSAttend`,
      `You have been invited to join ${orgName} as ${roleName}.\n\nAccept the invitation:\n${env.APP_URL}/accept-invitation?token=${token}\n\nThis invitation expires in 7 days.`,
    ),
  securityAlert: (to: string, text: string) => queueEmail(to, 'NTSAttend security alert', text),
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
