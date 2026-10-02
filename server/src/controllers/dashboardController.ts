import type { RequestHandler } from 'express';
import type { AppDeps } from '../lib/config.js';
import { currentLawyerId } from '../middleware/requireAuth.js';
import { getDashboard } from '../services/dashboardService.js';
import { calendarMonth } from '../services/hearingService.js';
import { retryReminder } from '../services/reminderService.js';
import { calendarQuerySchema } from '../validators/dashboardValidators.js';
import { idParamSchema, parseParams } from '../validators/common.js';

export function dashboardController({ prisma }: AppDeps) {
  const dashboard: RequestHandler = async (req, res) => {
    res.json(await getDashboard(prisma, currentLawyerId(req)));
  };

  const calendar: RequestHandler = async (req, res) => {
    const { month } = calendarQuerySchema.parse(req.query);
    res.json({ month, hearings: await calendarMonth(prisma, currentLawyerId(req), month) });
  };

  return { dashboard, calendar };
}

export function reminderController({ prisma }: AppDeps) {
  const retry: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    res.json({ reminder: await retryReminder(prisma, currentLawyerId(req), id) });
  };

  return { retry };
}
