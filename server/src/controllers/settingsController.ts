import type { RequestHandler } from 'express';
import type { AppDeps } from '../lib/config.js';
import { endSession, startSession } from '../lib/session.js';
import { istDateString } from '../lib/time.js';
import { currentLawyerId } from '../middleware/requireAuth.js';
import * as settingsService from '../services/settingsService.js';
import {
  changePasswordSchema,
  deleteAccountSchema,
  profileSchema,
  reminderPrefsSchema,
} from '../validators/settingsValidators.js';

export function settingsController({ prisma, mailer, sms, config }: AppDeps) {
  const getProfile: RequestHandler = async (req, res) => {
    res.json({ profile: await settingsService.getProfile(prisma, currentLawyerId(req)) });
  };

  const updateProfile: RequestHandler = async (req, res) => {
    const input = profileSchema.parse(req.body);
    res.json({
      profile: await settingsService.updateProfile(prisma, currentLawyerId(req), input),
    });
  };

  const changePassword: RequestHandler = async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const lawyerId = currentLawyerId(req);
    await settingsService.changePassword(prisma, lawyerId, input);
    // This session continues with the new password; all others have ended.
    await startSession(res, prisma, config, lawyerId);
    res.json({ message: 'Your password has been changed. Other devices have been logged out.' });
  };

  const getReminders: RequestHandler = async (req, res) => {
    res.json({
      preferences: await settingsService.getReminderPrefs(prisma, currentLawyerId(req)),
    });
  };

  const updateReminders: RequestHandler = async (req, res) => {
    const input = reminderPrefsSchema.parse(req.body);
    res.json(await settingsService.updateReminderPrefs(prisma, currentLawyerId(req), input));
  };

  const testReminder: RequestHandler = async (req, res) => {
    res.json(
      await settingsService.sendTestReminder(
        { prisma, mailer, sms, clientUrl: config.clientUrl },
        currentLawyerId(req),
      ),
    );
  };

  const exportData: RequestHandler = async (req, res) => {
    const data = await settingsService.exportData(prisma, currentLawyerId(req));
    const filename = `casemate-data-${istDateString(new Date())}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json').send(JSON.stringify(data, null, 2));
  };

  const deleteAccount: RequestHandler = async (req, res) => {
    const input = deleteAccountSchema.parse(req.body);
    await settingsService.deleteAccount(prisma, currentLawyerId(req), input);
    endSession(res, config);
    res.json({ message: 'Your account and all its data have been deleted.' });
  };

  return {
    getProfile,
    updateProfile,
    changePassword,
    getReminders,
    updateReminders,
    testReminder,
    exportData,
    deleteAccount,
  };
}
