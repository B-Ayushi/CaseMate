declare global {
  namespace Express {
    interface Request {
      // Set by requireAuth for routes that need a logged-in lawyer.
      lawyerId?: string;
    }
  }
}

export {};
