import type { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorHandler, notFoundHandler } from './middleware/errorHandlers.js';
import { healthRoutes } from './routes/healthRoutes.js';

export interface AppOptions {
  prisma: PrismaClient;
  clientUrl: string;
}

export function createApp({ prisma, clientUrl }: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: clientUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/health', healthRoutes(prisma));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
