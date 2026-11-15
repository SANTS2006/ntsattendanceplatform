/** Global permission catalogue. Roles are per-organization; permissions are global keys. */
export const PERMISSIONS = {
  'organization.manage': ['Organization', 'Edit organization profile and logo'],
  'settings.manage': ['Organization', 'Configure attendance, student ID and location settings'],
  'members.read': ['Users', 'View organization members'],
  'members.manage': ['Users', 'Invite, suspend and assign roles to members'],
  'roles.manage': ['Users', 'Create and edit custom roles'],
  'audit.read': ['Organization', 'View organization audit logs'],
  'students.read': ['Students', 'View students'],
  'students.create': ['Students', 'Create students'],
  'students.update': ['Students', 'Edit students and enrollments'],
  'students.delete': ['Students', 'Deactivate or delete students'],
  'students.import': ['Students', 'Bulk import students'],
  'academics.read': ['Academics', 'View faculties, departments, programs, courses and classes'],
  'academics.manage': ['Academics', 'Manage academic structure and lecturer assignments'],
  'lecturers.read': ['Lecturers', 'View lecturers'],
  'lecturers.manage': ['Lecturers', 'Create and edit lecturers'],
  'events.read': ['Events', 'View events'],
  'events.manage': ['Events', 'Create and manage events and participants'],
  'events.manage_assigned': ['Events', 'Create events and register participants for events you manage'],
  'classes.manage_assigned': ['Academics', 'Create classes and enroll students in classes you are assigned to'],
  'attendance.sessions.create': ['Attendance', 'Create attendance sessions for assigned classes/events'],
  'attendance.sessions.manage_all': ['Attendance', 'Create and manage sessions for any class or event in scope'],
  'attendance.read_all': ['Attendance', 'View all attendance records in scope'],
  'attendance.read_assigned': ['Attendance', 'View attendance for assigned classes/events'],
  'attendance.correct': ['Attendance', 'Correct or invalidate attendance records'],
  'attendance.export': ['Attendance', 'Export attendance within the permitted scope'],
  'reports.read': ['Reports', 'View attendance analytics and reports'],
  'reports.export': ['Reports', 'Generate report exports'],
  'selfies.read': ['Attendance', 'View attendance selfies'],
} as const satisfies Record<string, readonly [string, string]>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export const SYSTEM_ROLES: Record<string, { name: string; description: string; permissions: PermissionKey[] }> = {
  admin: {
    name: 'Administrator',
    description: 'Full management of the organization',
    permissions: ALL_PERMISSIONS,
  },
  department_admin: {
    name: 'Department Administrator',
    description: 'Manages students, academics and attendance for an assigned department',
    permissions: [
      'students.read', 'students.create', 'students.update', 'students.import',
      'academics.read', 'academics.manage', 'lecturers.read', 'events.read',
      'attendance.sessions.create', 'attendance.sessions.manage_all', 'attendance.read_all',
      'attendance.correct', 'attendance.export', 'reports.read', 'reports.export', 'selfies.read',
    ],
  },
  lecturer: {
    name: 'Lecturer',
    description: 'Runs attendance sessions for assigned classes and events',
    permissions: [
      'academics.read', 'events.read', 'attendance.sessions.create', 'attendance.read_assigned',
      'attendance.export', 'reports.read', 'reports.export', 'selfies.read',
      'classes.manage_assigned', 'events.manage_assigned',
    ],
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only access to students, academics and attendance',
    permissions: ['students.read', 'academics.read', 'lecturers.read', 'events.read', 'attendance.read_all', 'reports.read'],
  },
};
