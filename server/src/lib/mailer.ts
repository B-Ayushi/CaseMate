import nodemailer, { type Transporter } from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      'Email is not configured: set SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM in server/.env.',
    );
    this.name = 'EmailNotConfiguredError';
  }
}

export function createSmtpTransport({ host, port, user, pass }: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host,
    port,
    // Port 465 uses TLS from the start; other ports (587) upgrade with STARTTLS.
    secure: port === 465,
    auth: { user, pass },
  });
}

export function createMailer(transport: Transporter, from: string): Mailer {
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

// Used when SMTP settings are missing: every send fails with a clear reason.
export function createUnconfiguredMailer(): Mailer {
  return {
    async send() {
      throw new EmailNotConfiguredError();
    },
  };
}

export function createMailerFromEnv(
  env: {
    SMTP_HOST?: string;
    SMTP_PORT: number;
    SMTP_USER?: string;
    SMTP_PASS?: string;
    EMAIL_FROM?: string;
  },
  options: { verify?: boolean } = {},
): { mailer: Mailer; close: () => void } {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) {
    console.warn(
      'Email is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM in server/.env). ' +
        'Password reset emails, reminders and invoices will fail to send until it is.',
    );
    return { mailer: createUnconfiguredMailer(), close: () => {} };
  }

  const smtp = createSmtpTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    user: SMTP_USER,
    pass: SMTP_PASS,
  });
  if (options.verify) {
    // Check the SMTP login at startup so a wrong password shows up now, not when a lawyer
    // first needs an email.
    smtp.verify().then(
      () => console.log(`SMTP ready (${SMTP_HOST}:${SMTP_PORT})`),
      (error: unknown) =>
        console.error(
          `SMTP check failed for ${SMTP_HOST}:${SMTP_PORT}. Emails will not send until this is fixed:`,
          error instanceof Error ? error.message : error,
        ),
    );
  }
  return { mailer: createMailer(smtp, EMAIL_FROM), close: () => smtp.close() };
}
