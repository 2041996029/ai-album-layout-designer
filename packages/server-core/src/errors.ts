export class ServiceError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public details: unknown = {},
  ) {
    super(code);
  }
}
export function fail(code: string, status = 400, details: unknown = {}): never {
  throw new ServiceError(code, status, details);
}
