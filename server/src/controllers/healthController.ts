import type { PrismaClient } from '@prisma/client';
import type { RequestHandler } from 'express';
import { checkHealth } from '../services/healthService.js';

export function healthController(prisma: PrismaClient): RequestHandler {
  return async (_req, res) => {
    const result = await checkHealth(prisma);
    res.status(result.ok ? 200 : 503).json(result.body);
  };
}
