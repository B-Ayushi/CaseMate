// An error with an HTTP status and a message that is safe to show to the user, plus
// optional per-field messages for forms.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
