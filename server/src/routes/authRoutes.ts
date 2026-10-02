import { Router } from 'express';
import type { AppDeps } from '../lib/config.js';
import { authController } from '../controllers/authController.js';
import { createAuthRateLimiters } from '../middleware/rateLimiters.js';
import { requireAuth } from '../middleware/requireAuth.js';

export function authRoutes(deps: AppDeps): Router {
  const router = Router();
  const controller = authController(deps);
  const limit = createAuthRateLimiters({ signupsPerHour: deps.config.signupsPerHour });

  router.post('/signup', limit.signup, controller.signup);
  router.post('/login', limit.login, controller.login);
  router.post('/logout', controller.logout);
  router.get('/me', requireAuth(deps.prisma, deps.config), controller.me);
  router.post('/forgot-password', limit.forgotPassword, controller.forgotPassword);
  router.post('/reset-password', controller.resetPassword);

  return router;
}
