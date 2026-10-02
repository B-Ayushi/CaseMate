import type { PrismaClient } from '@prisma/client';
import type { Mailer } from './mailer.js';
import type { SmsProvider } from './sms.js';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  clientUrl: string;
  jwtSecret: string;
}

// Everything the app needs from the outside world, passed in explicitly so the server
// and the tests build the app the same way.
export interface AppDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  sms: SmsProvider;
  config: AppConfig;
}
