# User roles and permissions

## Platform level

| Role | Access |
|---|---|
| Super Admin | Everything under `/platform`: organizations (view, activate, suspend, reactivate, deactivate), users, analytics, security events, audit logs, system health, platform settings, and granting/revoking platform admins |
| Platform Admin | Same views and organization/user management, but cannot grant or revoke platform access |

Granted only by `npm run platform:grant-admin` (first admin) or by a Super Admin. Every platform
action is audited with actor type `PLATFORM_ADMIN`. Organization roles never confer platform access.

## Organization level

The **owner** (creator) implicitly holds every permission and cannot be suspended or removed.

| System role | Purpose |
|---|---|
| Administrator | All organization permissions |
| Department Administrator | Students, academics and attendance, optionally limited to one department |
| Lecturer | Runs attendance for assigned classes/events; sees only assigned classes and their records |
| Viewer | Read-only students, academics and attendance |

Owners (or members with `roles.manage`) can create **custom roles** from the catalogue below.
Members can only grant permissions they hold organization-wide.

| Group | Permissions |
|---|---|
| Organization | `organization.manage`, `settings.manage`, `audit.read` |
| Users | `members.read`, `members.manage`, `roles.manage` |
| Students | `students.read`, `students.create`, `students.update`, `students.delete`, `students.import` |
| Academics | `academics.read`, `academics.manage` |
| Lecturers | `lecturers.read`, `lecturers.manage` |
| Events | `events.read`, `events.manage` |
| Attendance | `attendance.sessions.create`, `attendance.sessions.manage_all`, `attendance.read_all`, `attendance.read_assigned`, `attendance.correct`, `attendance.export`, `selfies.read` |
| Reports | `reports.read`, `reports.export` |

Department scoping: assigning a role "for department X" limits its permissions to that
department's students, courses, classes and sessions.

## Lecturer accounts and multiple organizations

- **Adding a lecturer creates their account.** When a lecturer is added (one at a time or by import),
  NTSAttend creates an account for that email in the organization with the Lecturer role and emails a
  single-use link (7 days) to set a password. The lecturer list shows *Awaiting setup* / *Active*, and
  *Resend email* issues a fresh link (older links stop working). If the email already has an
  NTSAttend account, that account is added to the organization and notified — its password and other
  memberships are untouched. “Forgot password” also completes a pending account.
- **One identity, many organizations.** An account can belong to several organizations. A lecturer
  (or invited user) can sign up with the same email — the code-verified sign-up completes the account
  the institution created — and create their own organization, where they are the owner with every
  administrator permission. The organization switcher groups *Your organizations* and *Organizations
  you work in*; *Create your own organization* is always available.
- **Separation.** Roles and permissions are per organization; being an owner in one organization
  grants nothing in another, and data never crosses organizations.

## Students

Students have no accounts. They can only use the QR-scoped public attendance flow and view their
own confirmation (reference number + secret confirmation token).
