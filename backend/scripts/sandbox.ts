/**
 * Sandbox API: same as "npm run dev" but with in-memory file storage and captured emails
 * (the mode automated tests use). Lets you try the app without Cloudinary/Brevo credentials and
 * without sending real emails. Sign-up codes are readable at GET /api/v1/__test__/mail?to=<email>.
 * Files and emails disappear when the process restarts. Never use this in production.
 */
process.env.NODE_ENV = 'test';
await import('../src/server.js');
