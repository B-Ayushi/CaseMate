import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { healthController } from '../controllers/healthController.js';

export function healthRoutes(prisma: PrismaClient): Router {
  const router = Router();
  router.get('/', healthController(prisma));
  return router;
}
