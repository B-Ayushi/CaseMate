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
