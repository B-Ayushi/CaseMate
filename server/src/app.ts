import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppDeps } from './lib/config.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandlers.js';
import { authRoutes } from './routes/authRoutes.js';
import { healthRoutes } from './routes/healthRoutes.js';

export function createApp(deps: AppDeps): Express {
  const { prisma, config } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/health', healthRoutes(prisma));
  app.use('/api/auth', authRoutes(deps));

  app.use('/api', notFoundHandler);
  app.use(errorHandler(config));

  return app;
}
