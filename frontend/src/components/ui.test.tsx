import { describe, expect, it } from 'vitest';
import { autoPlaceholder } from './ui';

describe('autoPlaceholder', () => {
  it('builds "Enter your …" from the label', () => {
    expect(autoPlaceholder('First name')).toBe('Enter your first name');
    expect(autoPlaceholder('Password')).toBe('Enter your password');
    expect(autoPlaceholder('Phone (optional)')).toBe('Enter your phone');
    expect(autoPlaceholder('Student ID *')).toBe('Enter your student ID');
    expect(autoPlaceholder('Lecturer', 'Select')).toBe('Select your lecturer');
    expect(autoPlaceholder(undefined)).toBeUndefined();
  });
});
