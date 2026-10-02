import { Router } from 'express';
import { dashboardController, reminderController } from '../controllers/dashboardController.js';
import type { AppDeps } from '../lib/config.js';

// Mounted behind requireAuth at /api/dashboard.
export function dashboardRoutes(deps: AppDeps): Router {
  const router = Router();
  router.get('/', dashboardController(deps).dashboard);
  return router;
}

// Mounted behind requireAuth at /api/calendar.
export function calendarRoutes(deps: AppDeps): Router {
  const router = Router();
  router.get('/', dashboardController(deps).calendar);
  return router;
}

// Mounted behind requireAuth at /api/reminders.
export function reminderRoutes(deps: AppDeps): Router {
  const router = Router();
  router.post('/:id/retry', reminderController(deps).retry);
  return router;
}
