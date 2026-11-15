export type StudentIdConfig = {
  studentIdExactLength: number | null;
  studentIdMinLength: number;
  studentIdMaxLength: number;
  studentIdCharset: 'NUMERIC' | 'ALPHA' | 'ALPHANUMERIC' | 'CUSTOM';
  studentIdCustomPattern: string | null;
  studentIdPrefix: string | null;
  studentIdSuffix: string | null;
  studentIdCaseSensitive: boolean;
  studentIdAllowSpaces: boolean;
};

const CHARSETS = { NUMERIC: '0-9', ALPHA: 'A-Za-z', ALPHANUMERIC: 'A-Za-z0-9' } as const;

/** Custom character classes may only contain literal letters, digits, ranges and - _ / . (no regex injection). */
export function sanitizeCustomPattern(p: string): string | null {
  if (!/^[A-Za-z0-9\-_/.]+$/.test(p) || p.length > 40) return null;
  return p.replace(/[/.]/g, (c) => `\\${c}`);
}

export function normalizeStudentId(raw: string, cfg: Pick<StudentIdConfig, 'studentIdCaseSensitive' | 'studentIdAllowSpaces'>): string {
  let v = raw.trim();
  v = cfg.studentIdAllowSpaces ? v.replace(/\s+/g, ' ') : v.replace(/\s+/g, '');
  return cfg.studentIdCaseSensitive ? v : v.toUpperCase();
}

export type StudentIdValidation = { valid: true; normalized: string } | { valid: false; reason: string };

export function validateStudentId(raw: string, cfg: StudentIdConfig): StudentIdValidation {
  const v = normalizeStudentId(raw, cfg);
  const len = v.length;
  if (len === 0) return { valid: false, reason: 'Student ID is required' };
  if (cfg.studentIdExactLength != null && len !== cfg.studentIdExactLength) {
    return { valid: false, reason: `Student ID must be exactly ${cfg.studentIdExactLength} characters` };
  }
  if (cfg.studentIdExactLength == null && (len < cfg.studentIdMinLength || len > cfg.studentIdMaxLength)) {
    return { valid: false, reason: `Student ID must be between ${cfg.studentIdMinLength} and ${cfg.studentIdMaxLength} characters` };
  }
  const norm = (s: string | null) => (s ? (cfg.studentIdCaseSensitive ? s : s.toUpperCase()) : '');
  const prefix = norm(cfg.studentIdPrefix);
  const suffix = norm(cfg.studentIdSuffix);
  if (prefix && !v.startsWith(prefix)) return { valid: false, reason: `Student ID must start with ${cfg.studentIdPrefix}` };
  if (suffix && !v.endsWith(suffix)) return { valid: false, reason: `Student ID must end with ${cfg.studentIdSuffix}` };
  const body = v.slice(prefix.length, v.length - suffix.length);
  let cls: string;
  if (cfg.studentIdCharset === 'CUSTOM') {
    const safe = cfg.studentIdCustomPattern ? sanitizeCustomPattern(cfg.studentIdCustomPattern) : null;
    cls = safe ?? CHARSETS.ALPHANUMERIC;
  } else cls = CHARSETS[cfg.studentIdCharset];
  if (cfg.studentIdAllowSpaces) cls += ' ';
  if (body.length > 0 && !new RegExp(`^[${cls}]+$`).test(body)) {
    return { valid: false, reason: 'Student ID contains characters that are not allowed' };
  }
  return { valid: true, normalized: v };
}

/** Public-safe description of the format for the attendance UI (counter, input mode). */
export function publicStudentIdFormat(cfg: StudentIdConfig & { studentIdExample?: string | null }) {
  return {
    exactLength: cfg.studentIdExactLength,
    minLength: cfg.studentIdExactLength ?? cfg.studentIdMinLength,
    maxLength: cfg.studentIdExactLength ?? cfg.studentIdMaxLength,
    charset: cfg.studentIdCharset,
    prefix: cfg.studentIdPrefix,
    suffix: cfg.studentIdSuffix,
    caseSensitive: cfg.studentIdCaseSensitive,
    allowSpaces: cfg.studentIdAllowSpaces,
    example: cfg.studentIdExample ?? null,
  };
}
