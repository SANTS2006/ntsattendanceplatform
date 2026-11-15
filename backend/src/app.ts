import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger, redactUrl } from './lib/logger.js';
import { testOutbox } from './infra/mailer.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { limits } from './middleware/rateLimit.js';
import { buildOpenApiDocument } from './openapi/registry.js';
import { academicsRouter } from './modules/academics/academics.routes.js';
import { attendanceRouter } from './modules/attendance/attendance.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { eventsRouter } from './modules/events/events.routes.js';
import { filesRouter } from './modules/media/files.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { lecturersRouter } from './modules/lecturers/lecturers.routes.js';
import { membersRouter } from './modules/members/members.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { organizationsRouter } from './modules/organizations/organizations.routes.js';
import { platformRouter } from './modules/platform/platform.routes.js';
import { publicAttendanceRouter } from './modules/public-attendance/public.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { studentsRouter } from './modules/students/students.routes.js';
import { importsRouter } from './modules/imports/imports.routes.js';
import { platformSupportRouter, supportRouter } from './modules/support/support.routes.js';
import { backupsRouter } from './modules/backups/backups.routes.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY === 'false' ? false : env.TRUST_PROXY);
  app.set('query parser', 'simple');

  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: redactUrl(req.url) }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          // The API also serves the web app (single origin on Render), so the policy covers both.
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', 'https://api.cloudinary.com', 'https://*.googleusercontent.com'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'https://accounts.google.com/gsi/', 'wss:', 'ws:'],
          frameSrc: ['https://accounts.google.com/gsi/'],
          mediaSrc: ["'self'", 'blob:'],
          workerSrc: ["'self'", 'blob:'],
          upgradeInsecureRequests: env.isProd ? [] : null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Google Identity Services popups need opener access.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: env.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()');
    next();
  });

  const allowed = new Set([...env.corsOrigins, new URL(env.APP_URL).origin]);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-NTS-CSRF', 'X-Attempt-Token', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));
  app.use(cookieParser());

  app.use('/health', healthRouter);

  const api = express.Router();
  api.use(limits.api());
  api.use('/auth', authRouter);
  api.use('/organizations', organizationsRouter);
  api.use(membersRouter);
  api.use(studentsRouter);
  api.use('/imports', importsRouter);
  api.use(academicsRouter);
  api.use(lecturersRouter);
  api.use(eventsRouter);
  api.use('/attendance', attendanceRouter);
  api.use('/public/attendance', publicAttendanceRouter);
  api.use('/reports', reportsRouter);
  api.use('/platform', platformRouter);
  api.use('/platform', platformSupportRouter);
  api.use('/platform', backupsRouter);
  api.use(supportRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/files', filesRouter);
  // Test-only: read captured emails (sign-up codes) in end-to-end tests. Never registered otherwise.
  if (env.isTest) {
    api.get('/__test__/mail', (req, res) => {
      const to = String(req.query.to ?? '').toLowerCase();
      const mail = [...testOutbox()].reverse().find((m) => m.to.toLowerCase() === to);
      res.json({ success: true, data: mail ? { subject: mail.subject, text: mail.text } : null });
    });
  }
  app.use('/api/v1', api);

  const doc = buildOpenApiDocument();
  app.get('/api/v1/openapi.json', (_req, res) => res.json(doc));
  if (!env.isProd) app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(doc, { customSiteTitle: 'NTSAttend API' }));

  // Serve the built web app (single-origin hosting: same site for cookies, API and Socket.IO).
  const webDir = path.resolve(env.WEB_DIST_DIR ?? path.join(import.meta.dirname, '..', '..', 'frontend', 'dist'));
  if (!env.isTest && fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(
      express.static(webDir, {
        index: false,
        maxAge: '1h',
        // Vite's hashed bundles never change, so they can be cached for a year.
        setHeaders: (res, file) => {
          if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get(/^(?!\/api\/|\/health\/|\/socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
