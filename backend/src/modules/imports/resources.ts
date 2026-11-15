import type { PermissionKey } from '../../config/permissions.js';

/**
 * Declarative import specs. Each resource lists its columns (with heading aliases used for
 * automatic column matching), types, references to other tenant records and the field(s) that
 * identify an existing record.
 */
export type FieldType = 'text' | 'code' | 'int' | 'date' | 'datetime' | 'email' | 'bool';
export type RefModel = 'faculty' | 'department' | 'program' | 'academicLevel' | 'academicYear' | 'course';

export type FieldSpec = {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  max?: number;
  min?: number; // for int
  maxValue?: number; // for int
  aliases?: string[];
  /** Resolve to a record id by code or name within the tenant; stored in `refField`. */
  ref?: { model: RefModel; refField: string };
};

export type ResourceSpec = {
  resource: string;
  label: string; // singular, for messages
  model: string; // Prisma delegate on the tenant client
  permission: PermissionKey;
  fields: FieldSpec[];
  /** Fields (after transformation) that identify an existing record. */
  uniqueBy: string[];
  /** Cross-field validation on the transformed data. */
  check?: (data: Record<string, unknown>) => string | null;
};

const name = (label = 'Name', aliases: string[] = []): FieldSpec => ({ key: 'name', label, required: true, max: 150, aliases: ['name', 'title', ...aliases] });
const code = (aliases: string[] = []): FieldSpec => ({ key: 'code', label: 'Code', type: 'code', required: true, max: 30, aliases: ['code', 'short code', 'abbreviation', ...aliases] });
const ref = (key: string, label: string, model: RefModel, refField: string, aliases: string[] = [], required = false): FieldSpec => ({
  key, label, ref: { model, refField }, required, aliases: [key, label.toLowerCase(), ...aliases],
});
const dates = (data: Record<string, unknown>, a: string, b: string, msg: string) =>
  data[a] instanceof Date && data[b] instanceof Date && (data[b] as Date) <= (data[a] as Date) ? msg : null;

export const RESOURCES: Record<string, ResourceSpec> = {
  faculties: {
    resource: 'faculties', label: 'faculty', model: 'faculty', permission: 'academics.manage', uniqueBy: ['code'],
    fields: [name('Faculty name', ['faculty', 'faculty name']), code(['faculty code'])],
  },
  departments: {
    resource: 'departments', label: 'department', model: 'department', permission: 'academics.manage', uniqueBy: ['code'],
    fields: [name('Department name', ['department', 'department name']), code(['department code', 'dept code']), ref('faculty', 'Faculty', 'faculty', 'facultyId', ['faculty code', 'school'])],
  },
  programs: {
    resource: 'programs', label: 'program', model: 'program', permission: 'academics.manage', uniqueBy: ['code'],
    fields: [
      name('Program name', ['program', 'programme', 'program name', 'programme name']), code(['program code', 'programme code']),
      ref('department', 'Department', 'department', 'departmentId', ['dept', 'department code']),
      { key: 'durationYears', label: 'Duration (years)', type: 'int', min: 1, maxValue: 10, aliases: ['duration', 'years', 'duration years'] },
    ],
  },
  levels: {
    resource: 'levels', label: 'level', model: 'academicLevel', permission: 'academics.manage', uniqueBy: ['name'],
    fields: [
      { key: 'name', label: 'Level name', required: true, max: 60, aliases: ['name', 'level', 'level name', 'year'] },
      { key: 'rank', label: 'Order', type: 'int', min: 0, maxValue: 100, aliases: ['order', 'rank', 'sort', 'position'] },
    ],
  },
  'academic-years': {
    resource: 'academic-years', label: 'academic year', model: 'academicYear', permission: 'academics.manage', uniqueBy: ['name'],
    fields: [
      { key: 'name', label: 'Academic year', required: true, max: 30, aliases: ['name', 'academic year', 'session', 'year'] },
      { key: 'startDate', label: 'Start date', type: 'date', required: true, aliases: ['start', 'start date', 'starts', 'from'] },
      { key: 'endDate', label: 'End date', type: 'date', required: true, aliases: ['end', 'end date', 'ends', 'to'] },
      { key: 'isCurrent', label: 'Current', type: 'bool', aliases: ['current', 'is current', 'active'] },
    ],
    check: (d) => dates(d, 'startDate', 'endDate', 'End date must be after the start date'),
  },
  semesters: {
    resource: 'semesters', label: 'semester', model: 'semester', permission: 'academics.manage', uniqueBy: ['academicYearId', 'name'],
    fields: [
      ref('academicYear', 'Academic year', 'academicYear', 'academicYearId', ['session', 'year'], true),
      { key: 'name', label: 'Semester name', required: true, max: 60, aliases: ['name', 'semester', 'term', 'semester name'] },
      { key: 'startDate', label: 'Start date', type: 'date', required: true, aliases: ['start', 'start date', 'from'] },
      { key: 'endDate', label: 'End date', type: 'date', required: true, aliases: ['end', 'end date', 'to'] },
      { key: 'isCurrent', label: 'Current', type: 'bool', aliases: ['current', 'is current', 'active'] },
    ],
    check: (d) => dates(d, 'startDate', 'endDate', 'End date must be after the start date'),
  },
  courses: {
    resource: 'courses', label: 'course', model: 'course', permission: 'academics.manage', uniqueBy: ['code'],
    fields: [
      code(['course code', 'module code']),
      { key: 'title', label: 'Course title', required: true, max: 150, aliases: ['title', 'course title', 'course name', 'name', 'module'] },
      ref('department', 'Department', 'department', 'departmentId', ['dept']),
      ref('program', 'Program', 'program', 'programId', ['programme']),
      ref('level', 'Level', 'academicLevel', 'levelId', ['academic level', 'year of study']),
      { key: 'credits', label: 'Credits', type: 'int', min: 0, maxValue: 100, aliases: ['credits', 'credit units', 'units'] },
      { key: 'description', label: 'Description', max: 2000, aliases: ['description', 'details', 'summary'] },
    ],
  },
  classes: {
    resource: 'classes', label: 'class', model: 'class', permission: 'academics.manage', uniqueBy: ['code'],
    fields: [
      code(['class code', 'group code', 'section code']),
      { key: 'name', label: 'Class name', required: true, max: 150, aliases: ['name', 'class', 'class name', 'group', 'section'] },
      ref('course', 'Course', 'course', 'courseId', ['course code', 'module']),
      { key: 'room', label: 'Room / venue', max: 80, aliases: ['room', 'venue', 'location', 'hall'] },
    ],
  },
  lecturers: {
    resource: 'lecturers', label: 'lecturer', model: 'lecturer', permission: 'lecturers.manage', uniqueBy: ['email'],
    fields: [
      { key: 'firstName', label: 'First name', required: true, max: 80, aliases: ['first name', 'firstname', 'given name', 'forename'] },
      { key: 'lastName', label: 'Last name', required: true, max: 80, aliases: ['last name', 'lastname', 'surname', 'family name'] },
      { key: 'email', label: 'Email', type: 'email', required: true, max: 254, aliases: ['email', 'email address', 'e-mail'] },
      { key: 'title', label: 'Title', max: 30, aliases: ['title', 'salutation', 'prefix'] },
      { key: 'staffNumber', label: 'Staff number', max: 40, aliases: ['staff number', 'staff id', 'employee number', 'staff no'] },
      { key: 'phone', label: 'Phone', max: 30, aliases: ['phone', 'phone number', 'mobile', 'telephone'] },
      ref('department', 'Department', 'department', 'departmentId', ['dept']),
    ],
  },
  events: {
    resource: 'events', label: 'event', model: 'event', permission: 'events.manage', uniqueBy: ['name', 'startsAt'],
    fields: [
      name('Event name', ['event', 'event name']),
      { key: 'startsAt', label: 'Starts', type: 'datetime', required: true, aliases: ['starts', 'start', 'start time', 'starts at', 'date'] },
      { key: 'endsAt', label: 'Ends', type: 'datetime', required: true, aliases: ['ends', 'end', 'end time', 'ends at'] },
      { key: 'venue', label: 'Venue', max: 200, aliases: ['venue', 'location', 'place', 'hall'] },
      { key: 'description', label: 'Description', max: 2000, aliases: ['description', 'details', 'summary'] },
      { key: 'requireRegistration', label: 'Registration required', type: 'bool', aliases: ['registration required', 'require registration', 'registered only'] },
    ],
    check: (d) => dates(d, 'startsAt', 'endsAt', 'End must be after the start'),
  },
};
