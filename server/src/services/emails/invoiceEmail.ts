import { formatInTimeZone } from 'date-fns-tz';
import type { MailMessage } from '../../lib/mailer.js';
import { emailLayout, escapeHtml } from './layout.js';

// The email that carries an invoice PDF to the client.
export function invoiceEmail(params: {
  to: string;
  clientName: string;
  lawyerName: string;
  number: string;
  total: string;
  dueDate: string; // "yyyy-MM-dd"
}): Omit<MailMessage, 'attachments'> {
  const { to, clientName, lawyerName, number, total, dueDate } = params;
  const due = formatInTimeZone(new Date(`${dueDate}T00:00:00Z`), 'UTC', 'd MMMM yyyy');
  const lines = [
    `Dear ${clientName},`,
    `Please find attached invoice ${number} for ${total}, due by ${due}.`,
    'Do get in touch if you have any questions.',
    `Regards,\n${lawyerName}`,
  ];
  return {
    to,
    subject: `Invoice ${number} from ${lawyerName}`,
    text: lines.join('\n\n'),
    html: emailLayout(
      `Invoice ${number}`,
      lines.map((line) => `<p style="white-space:pre-line">${escapeHtml(line)}</p>`).join(''),
    ),
  };
}
