import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { AppConfig } from '../lib/config.js';
import { HttpError } from '../lib/httpError.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};

// Errors raised by express.json() for bad request bodies.
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as BodyParserError).type === 'string' &&
    typeof (err as BodyParserError).status === 'number'
  );
}

function fieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

// Every error leaves the server as clean JSON: { error, fields? }. Unexpected errors are
// logged on the server; the stack is only included in development, never in production.
export function errorHandler(config: Pick<AppConfig, 'nodeEnv'>): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res
        .status(400)
        .json({ error: 'Please check the highlighted fields.', fields: fieldErrors(err) });
      return;
    }
    if (err instanceof HttpError) {
      res
        .status(err.status)
        .json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
      return;
    }
    if (isBodyParserError(err)) {
      const message =
        err.type === 'entity.parse.failed'
          ? 'The request body is not valid JSON.'
          : err.type === 'entity.too.large'
            ? 'The request body is too large.'
            : 'The request could not be read.';
      res.status(err.status >= 400 && err.status < 500 ? err.status : 400).json({ error: message });
      return;
    }

    console.error(err);
    const body: { error: string; stack?: string } = {
      error: 'Something went wrong on the server. Please try again.',
    };
    if (config.nodeEnv === 'development' && err instanceof Error) {
      body.stack = err.stack;
    }
    res.status(500).json(body);
  };
}
