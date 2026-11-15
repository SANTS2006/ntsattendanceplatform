import type { Request } from 'express';
import type { FeedbackCategory, FeedbackStatus, Prisma, SupportCategory, SupportPriority, SupportStatus } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { forbidden, notFound } from '../../lib/errors.js';
import type { TenantContext } from '../../middleware/context.js';
import { audit } from '../audit/audit.service.js';
import { notifyUser, queueEmail } from '../notifications/notify.js';

/** Organization owners and administrators (organization.manage) talk to the platform team. */
export function assertCanContactPlatform(ctx: TenantContext) {
  if (!ctx.isOwner && !ctx.has('organization.manage')) throw forbidden('Only the organization owner or administrators can contact support', 'SUPPORT_FORBIDDEN');
}

async function people(ids: string[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, firstName: true, lastName: true, email: true } });
  return new Map(users.map((u) => [u.id, u]));
}

async function withMessages(ticketId: string) {
  const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  const org = await prisma.organization.findUnique({ where: { id: ticket.organizationId }, select: { id: true, name: true } });
  const who = await people([ticket.createdById, ...ticket.messages.map((m) => m.authorId)]);
  return {
    ...ticket,
    organization: org,
    createdBy: who.get(ticket.createdById) ?? null,
    messages: ticket.messages.map((m) => ({ ...m, author: who.get(m.authorId) ?? null })),
  };
}

async function notifyPlatformAdmins(title: string, body: string, data: Prisma.InputJsonValue) {
  const admins = await prisma.platformAdmin.findMany({ select: { userId: true } });
  await Promise.all(admins.map((a) => notifyUser({ userId: a.userId, type: 'support.message', title, body, data })));
}

// ── Organization side ───────────────────────────────────────────────────────

export async function listTickets(ctx: TenantContext, q: { page: number; pageSize: number; status?: SupportStatus }) {
  assertCanContactPlatform(ctx);
  const where = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    ctx.db.supportTicket.findMany({ where, orderBy: { lastMessageAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { messages: true } } } }),
    ctx.db.supportTicket.count({ where }),
  ]);
  return { items, total };
}

export async function createTicket(
  ctx: TenantContext,
  input: { subject: string; category: SupportCategory; priority: SupportPriority; message: string },
  req: Request,
) {
  assertCanContactPlatform(ctx);
  const ticket = await ctx.db.supportTicket.create({
    data: {
      organizationId: ctx.organizationId, createdById: ctx.userId, subject: input.subject, category: input.category, priority: input.priority,
      messages: { create: { authorId: ctx.userId, body: input.message } },
    },
  });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } });
  await notifyPlatformAdmins(`New support request from ${org.name}`, input.subject, { ticketId: ticket.id, link: `/platform/support?ticket=${ticket.id}` });
  await audit({ action: 'support.ticket_created', targetType: 'SupportTicket', targetId: ticket.id, metadata: { category: input.category, priority: input.priority }, req });
  return withMessages(ticket.id);
}

async function loadOrgTicket(ctx: TenantContext, id: string) {
  assertCanContactPlatform(ctx);
  const t = await ctx.db.supportTicket.findUnique({ where: { id } });
  if (!t) throw notFound('Support request');
  return t;
}

export async function getTicket(ctx: TenantContext, id: string) {
  const t = await loadOrgTicket(ctx, id);
  if (t.orgUnread) await ctx.db.supportTicket.update({ where: { id }, data: { orgUnread: false } });
  return withMessages(id);
}

export async function replyAsOrganization(ctx: TenantContext, id: string, body: string, req: Request) {
  const t = await loadOrgTicket(ctx, id);
  await prisma.supportMessage.create({ data: { ticketId: t.id, authorId: ctx.userId, body } });
  await ctx.db.supportTicket.update({ where: { id: t.id }, data: { status: 'OPEN', lastMessageAt: new Date(), platformUnread: true, orgUnread: false } });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } });
  await notifyPlatformAdmins(`New reply from ${org.name}`, t.subject, { ticketId: t.id, link: `/platform/support?ticket=${t.id}` });
  await audit({ action: 'support.message_sent', targetType: 'SupportTicket', targetId: t.id, req });
  return withMessages(t.id);
}

export async function closeTicket(ctx: TenantContext, id: string, req: Request) {
  const t = await loadOrgTicket(ctx, id);
  await ctx.db.supportTicket.update({ where: { id: t.id }, data: { status: 'CLOSED' } });
  await audit({ action: 'support.ticket_closed', targetType: 'SupportTicket', targetId: t.id, req });
  return withMessages(t.id);
}

export async function orgUnreadCount(ctx: TenantContext) {
  if (!ctx.isOwner && !ctx.has('organization.manage')) return { unread: 0 };
  return { unread: await ctx.db.supportTicket.count({ where: { orgUnread: true } }) };
}

// ── Platform side ───────────────────────────────────────────────────────────

export async function platformList(q: { page: number; pageSize: number; status?: SupportStatus; search?: string; unread?: boolean }) {
  const where: Prisma.SupportTicketWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.unread ? { platformUnread: true } : {}),
    ...(q.search ? { subject: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [items, total, unread, open] = await Promise.all([
    prisma.supportTicket.findMany({ where, orderBy: [{ platformUnread: 'desc' }, { lastMessageAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { messages: true } } } }),
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.count({ where: { platformUnread: true } }),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'AWAITING_ORGANIZATION'] } } }),
  ]);
  const orgs = await prisma.organization.findMany({ where: { id: { in: items.map((i) => i.organizationId) } }, select: { id: true, name: true } });
  const byId = new Map(orgs.map((o) => [o.id, o]));
  return { items: items.map((i) => ({ ...i, organization: byId.get(i.organizationId) ?? null })), total, unread, open };
}

export async function platformGet(id: string) {
  const t = await prisma.supportTicket.findUnique({ where: { id } });
  if (!t) throw notFound('Support request');
  if (t.platformUnread) await prisma.supportTicket.update({ where: { id }, data: { platformUnread: false } });
  return withMessages(id);
}

export async function platformReply(id: string, adminId: string, input: { body: string; status?: SupportStatus }, req: Request) {
  const t = await prisma.supportTicket.findUnique({ where: { id } });
  if (!t) throw notFound('Support request');
  await prisma.supportMessage.create({ data: { ticketId: id, authorId: adminId, body: input.body, fromPlatform: true } });
  await prisma.supportTicket.update({
    where: { id },
    data: { status: input.status ?? 'AWAITING_ORGANIZATION', lastMessageAt: new Date(), orgUnread: true, platformUnread: false },
  });
  const creator = await prisma.user.findUnique({ where: { id: t.createdById }, select: { id: true, email: true, firstName: true } });
  if (creator) {
    await notifyUser({
      userId: creator.id, organizationId: t.organizationId, type: 'support.reply', title: 'The NTSAttend team replied',
      body: `Re: ${t.subject}`, data: { ticketId: id, link: `/app/support?ticket=${id}` },
    });
    await queueEmail(
      creator.email,
      `Re: ${t.subject} — NTSAttend support`,
      `Hello ${creator.firstName},\n\nThe NTSAttend team replied to your request "${t.subject}":\n\n${input.body.slice(0, 1500)}\n\nView the conversation:\n${env.APP_URL}/app/support?ticket=${id}`,
    );
  }
  await audit({ action: 'platform.support_replied', organizationId: t.organizationId, targetType: 'SupportTicket', targetId: id, actorType: 'PLATFORM_ADMIN', req });
  return withMessages(id);
}

export async function platformUpdate(id: string, input: { status?: SupportStatus; priority?: SupportPriority }, req: Request) {
  const t = await prisma.supportTicket.update({ where: { id }, data: input });
  await audit({ action: 'platform.support_updated', organizationId: t.organizationId, targetType: 'SupportTicket', targetId: id, metadata: input, actorType: 'PLATFORM_ADMIN', req });
  return withMessages(id);
}

// ── Feedback ────────────────────────────────────────────────────────────────

export async function submitFeedback(ctx: TenantContext, input: { category: FeedbackCategory; rating?: number | null; message: string }, req: Request) {
  assertCanContactPlatform(ctx);
  const fb = await ctx.db.feedback.create({
    data: { organizationId: ctx.organizationId, userId: ctx.userId, category: input.category, rating: input.rating ?? null, message: input.message },
  });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } });
  await notifyPlatformAdmins(`New feedback from ${org.name}`, input.message.slice(0, 140), { feedbackId: fb.id, link: '/platform/feedback' });
  await audit({ action: 'feedback.submitted', targetType: 'Feedback', targetId: fb.id, metadata: { category: input.category, rating: input.rating ?? null }, req });
  return fb;
}

export async function myFeedback(ctx: TenantContext) {
  assertCanContactPlatform(ctx);
  return ctx.db.feedback.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
}

export async function platformFeedback(q: { page: number; pageSize: number; status?: FeedbackStatus; category?: FeedbackCategory }) {
  const where: Prisma.FeedbackWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.category ? { category: q.category } : {}) };
  const [items, total, avg, fresh] = await Promise.all([
    prisma.feedback.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.feedback.count({ where }),
    prisma.feedback.aggregate({ _avg: { rating: true }, _count: { rating: true } }),
    prisma.feedback.count({ where: { status: 'NEW' } }),
  ]);
  const orgs = await prisma.organization.findMany({ where: { id: { in: items.map((i) => i.organizationId) } }, select: { id: true, name: true } });
  const who = await people(items.map((i) => i.userId));
  const byId = new Map(orgs.map((o) => [o.id, o]));
  return {
    items: items.map((i) => ({ ...i, organization: byId.get(i.organizationId) ?? null, user: who.get(i.userId) ?? null })),
    total,
    summary: { averageRating: avg._avg.rating ? Math.round(avg._avg.rating * 10) / 10 : null, ratings: avg._count.rating, new: fresh },
  };
}

export async function platformUpdateFeedback(id: string, input: { status?: FeedbackStatus; adminNote?: string | null }, req: Request) {
  const before = await prisma.feedback.findUnique({ where: { id } });
  if (!before) throw notFound('Feedback');
  const fb = await prisma.feedback.update({ where: { id }, data: input });
  if (input.status && input.status !== before.status) {
    await notifyUser({
      userId: fb.userId, organizationId: fb.organizationId, type: 'feedback.status', title: 'Your feedback was updated',
      body: `Status: ${input.status.toLowerCase()}${input.adminNote ? ` — ${input.adminNote}` : ''}`, data: { feedbackId: id, link: '/app/feedback' },
    });
  }
  await audit({ action: 'platform.feedback_updated', organizationId: fb.organizationId, targetType: 'Feedback', targetId: id, metadata: input, actorType: 'PLATFORM_ADMIN', req });
  return fb;
}
