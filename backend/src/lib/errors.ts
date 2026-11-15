export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly errors?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', errors?: Record<string, unknown>) =>
  new AppError(400, code, message, errors);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') => new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to perform this action', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (what = 'Resource', code = 'NOT_FOUND') => new AppError(404, code, `${what} not found`);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
export const gone = (message: string, code: string) => new AppError(410, code, message);
export const unprocessable = (message: string, code: string, errors?: Record<string, unknown>) =>
  new AppError(422, code, message, errors);
export const tooMany = (message = 'Too many requests. Please try again later.', code = 'RATE_LIMITED') =>
  new AppError(429, code, message);
