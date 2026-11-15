/* Registers jest-dom matchers (toBeInTheDocument, toBeDisabled, …) on Vitest's expect types.
   Declared locally because jest-dom is hoisted to the workspace root and cannot resolve the
   frontend's vitest copy for its own augmentation. */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
