import type { Request, RequestHandler } from 'express';
import type { AppDeps } from '../lib/config.js';
import { HttpError } from '../lib/httpError.js';
import { endSession, startSession } from '../lib/session.js';
import { currentLawyerId } from '../middleware/requireAuth.js';
import * as authService from '../services/authService.js';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from '../validators/authValidators.js';

const FORGOT_PASSWORD_RESPONSE = {
  message: 'If an account exists for that email, we have sent a link to reset the password.',
};

export function authController({ prisma, mailer, config }: AppDeps) {
  const signup: RequestHandler = async (req, res) => {
    const input = signupSchema.parse(req.body);
    const lawyer = await authService.signup(prisma, input);
    await startSession(res, prisma, config, lawyer.id);
    res.status(201).json({ lawyer });
  };

  const login: RequestHandler = async (req, res) => {
    const input = loginSchema.parse(req.body);
    const lawyer = await authService.login(prisma, input);
    await startSession(res, prisma, config, lawyer.id);
    res.json({ lawyer });
  };

  const logout: RequestHandler = (_req, res) => {
    endSession(res, config);
    res.json({ message: 'You have been logged out.' });
  };

  const me: RequestHandler = async (req: Request, res) => {
    const lawyer = await authService.getLawyer(prisma, currentLawyerId(req));
    if (!lawyer) {
      // The account was deleted after this session was issued.
      endSession(res, config);
      throw new HttpError(401, 'Please log in to continue.');
    }
    res.json({ lawyer });
  };

  const forgotPassword: RequestHandler = (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    // Respond first and do the work afterwards, so the response is identical in content
    // and timing whether or not the email belongs to an account.
    res.json(FORGOT_PASSWORD_RESPONSE);
    authService
      .requestPasswordReset(prisma, mailer, config.clientUrl, email)
      .catch((error: unknown) => {
        console.error('Password reset email failed:', error);
      });
  };

  const resetPassword: RequestHandler = async (req, res) => {
    const input = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(prisma, input);
    res.json({ message: 'Your password has been changed. You can now log in.' });
  };

  return { signup, login, logout, me, forgotPassword, resetPassword };
}
