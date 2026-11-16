# API documentation

- Base URL: `/api/v1`
- Interactive docs (development): `http://localhost:4000/api/docs`
- Machine-readable: `GET /api/v1/openapi.json` or [`openapi.json`](openapi.json)
  (regenerate with `npm run openapi --workspace backend`)

Every route is declared with `defineRoute`, which registers both the Express handler chain and its
OpenAPI operation, so the document always matches the code.

## Conventions

Success:

```json
{ "success": true, "message": "Operation completed successfully", "data": {}, "meta": {} }
```

Error:

```json
{ "success": false, "message": "A descriptive error message", "errors": {}, "code": "ERROR_CODE" }
```

- Paginated lists accept `page` and `pageSize` (≤ 100) and return `meta: { page, pageSize, total, totalPages }`.
- Staff requests send `Authorization: Bearer <access token>`. The organization comes from the token.
- Public attendance steps send `X-Attempt-Token`; submit also sends `Idempotency-Key`.
- Refresh and logout require `X-NTS-CSRF: 1` (cookie-authenticated).

## Endpoint groups

| Group | Main endpoints |
|---|---|
| Auth | `GET /auth/config`, `POST/DELETE /auth/me/avatar`, `POST /auth/email-change`, `/auth/email-change/resend`, `/auth/email-change/verify`, `DELETE /auth/email-change`, `POST /auth/register`, `/auth/register/verify`, `/auth/register/resend`, `/auth/login`, `/auth/google`, `/auth/mfa/verify`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`, `GET/PATCH /auth/me`, `/auth/switch-organization`, `/auth/sessions`, `/auth/mfa/setup|enable|disable` |
| Organizations | `POST /organizations`, `GET/PATCH /organizations/current`, `POST/DELETE /organizations/current/logo`, `GET /organizations/current/overview`, `GET/PATCH /organizations/settings`, `GET /organizations/audit-logs` |
| Members & roles | `/organizations/members`, `/organizations/members/:id/roles`, `/organizations/invitations`, `/invitations/lookup`, `/invitations/accept`, `/roles`, `/permissions` |
| Students | `/students` (CRUD, search, filters), `/students/:id/attendance`, `/students/import` (upload), `/students/import/:id/preview` (`table: true` for row-by-row status), `/students/import/:id/commit` |
| Academics | `/faculties`, `/departments`, `/programs`, `/levels`, `/academic-years`, `/semesters`, `/courses`, `/classes`, `/classes/:id/lecturers`, `/classes/:id/students`, `/enrollments` |
| Lecturers & events | `/lecturers`, `/lecturers/me`, `/lecturers/:id/invite`, `/events`, `/events/:id/participants`, `/events/:id/managers` |
| Attendance | `/attendance/sessions` (list/create), `/:id`, `/:id/qr`, `/:id/close`, `/:id/revoke`, `/:id/replace`, `/:id/records`, `/:id/absentees`, `/:id/manual-records`, `/attendance/records`, `/attendance/records/:id`, `/attendance/records/:id/selfie` |
| Public attendance | `/public/attendance/:token/validate`, `/verify-student`, `/verify-location`, `/upload-selfie`, `/submit`, `GET /public/attendance/confirmation/:reference` |
| Bulk imports | `POST /imports/:resource` (upload CSV/XLSX; resource = faculties, departments, programs, levels, academic-years, semesters, courses, classes, lecturers, events), `/imports/:resource/:id/preview`, `/imports/:resource/:id/commit`, `GET /imports/:resource/:id` |
| Support & feedback | `GET/POST /support/tickets`, `GET /support/tickets/:id`, `POST /support/tickets/:id/messages`, `POST /support/tickets/:id/close`, `GET /support/unread`, `GET/POST /feedback` (owners and `organization.manage`) |
| Reports | `GET /reports/attendance`, `GET /reports/classes/:id/summary`, `POST /reports/export`, `GET /reports/export`, `GET /reports/export/:id` |
| Platform | `/platform/dashboard`, `/analytics`, `/organizations`, `/organizations/:id`, `/organizations/:id/status`, `/users`, `/users/:id/status`, `/audit-logs`, `/security-events`, `/system-health`, `/settings`, `/admins`, `/support/tickets` (inbox, reply, status), `/feedback` (triage), `/backups` (list, back up now, `/:id/download`, `/:id/restore` with `{"confirm":"RESTORE"}`, delete) |
| Other | `/notifications`, `GET /notifications/:id` (marks read), `/notifications/read-all`, `/health/live`, `/health/ready` |

## Real-time events (Socket.IO, path `/socket.io`)

Connect with `auth: { token: <access token> }`. Emit `session:subscribe { sessionId }` (server checks
access) and receive `attendance:recorded`, `attendance:corrected` and `session:updated`. Users with
organization-wide `attendance.read_all` can `org:subscribe`.
