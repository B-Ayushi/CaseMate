import type { MailMessage } from '../../lib/mailer.js';
import { formatIst } from '../../lib/time.js';
import { buttonHtml, emailLayout, escapeHtml } from './layout.js';

export interface HearingInfo {
  scheduledAt: Date;
  purpose: string | null;
  notes: string | null;
  case: {
    id: string;
    title: string;
    caseNumber: string;
    courtName: string;
    courtroom: string | null;
    client: { name: string };
  };
}

const dateLabel = (d: Date) => formatIst(d, 'EEEE, d MMMM yyyy');
const timeLabel = (d: Date) => formatIst(d, 'h:mm a');
const court = (h: HearingInfo) =>
  h.case.courtroom ? `${h.case.courtName}, ${h.case.courtroom}` : h.case.courtName;
const caseUrl = (clientUrl: string, h: HearingInfo) =>
  new URL(`/cases/${h.case.id}`, clientUrl).toString();

function detailRows(h: HearingInfo): [string, string][] {
  const rows: [string, string][] = [
    ['Case', `${h.case.title} (${h.case.caseNumber})`],
    ['Client', h.case.client.name],
    ['When', `${dateLabel(h.scheduledAt)}, ${timeLabel(h.scheduledAt)}`],
    ['Court', court(h)],
  ];
  if (h.purpose) rows.push(['Purpose', h.purpose]);
  if (h.notes) rows.push(['Your note', h.notes]);
  return rows;
}

function detailsHtml(h: HearingInfo): string {
  const rows = detailRows(h)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:4px 0;white-space:pre-line">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  return `<table style="border-collapse:collapse;font-size:15px">${rows}</table>`;
}

function detailsText(h: HearingInfo): string {
  return detailRows(h)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

export function dayBeforeEmail(to: string, h: HearingInfo, clientUrl: string): MailMessage {
  const title = `Hearing tomorrow: ${h.case.title}`;
  return {
    to,
    subject: `Tomorrow ${timeLabel(h.scheduledAt)}: ${h.case.title} at ${court(h)}`,
    text: `${title}\n\n${detailsText(h)}\n\nOpen the case: ${caseUrl(clientUrl, h)}`,
    html: emailLayout(title, detailsHtml(h) + buttonHtml(caseUrl(clientUrl, h), 'Open the case')),
  };
}

export function missingOutcomeEmail(to: string, h: HearingInfo, clientUrl: string): MailMessage {
  const title = `What happened in ${h.case.title}?`;
  const ask =
    'You have not recorded the outcome of today’s hearing or the next date yet. Log it now so the next reminders are set up.';
  return {
    to,
    subject: `Log the outcome: ${h.case.title}`,
    text: `${title}\n\n${ask}\n\n${detailsText(h)}\n\nLog the outcome: ${caseUrl(clientUrl, h)}`,
    html: emailLayout(
      title,
      `<p>${escapeHtml(ask)}</p>${detailsHtml(h)}${buttonHtml(caseUrl(clientUrl, h), 'Log the outcome')}`,
    ),
  };
}

export function dailySummaryEmail(
  to: string,
  day: Date,
  hearings: HearingInfo[],
  clientUrl: string,
): MailMessage {
  const title = `Your hearings today, ${formatIst(day, 'EEEE d MMMM')}`;
  const count = `${hearings.length} hearing${hearings.length === 1 ? '' : 's'} today`;
  const textItems = hearings
    .map(
      (h, i) =>
        `${i + 1}. ${timeLabel(h.scheduledAt)} - ${h.case.title} (${h.case.caseNumber})\n   ${court(h)}${h.purpose ? ` - ${h.purpose}` : ''}${h.notes ? `\n   Note: ${h.notes}` : ''}`,
    )
    .join('\n');
  const htmlItems = hearings
    .map(
      (h) =>
        `<li style="margin-bottom:12px"><strong>${escapeHtml(timeLabel(h.scheduledAt))}</strong> · <a href="${escapeHtml(caseUrl(clientUrl, h))}">${escapeHtml(h.case.title)}</a> (${escapeHtml(h.case.caseNumber)})<br><span style="color:#475569">${escapeHtml(court(h))}${h.purpose ? ` · ${escapeHtml(h.purpose)}` : ''}</span>${h.notes ? `<br><span style="color:#475569">Note: ${escapeHtml(h.notes)}</span>` : ''}</li>`,
    )
    .join('');
  return {
    to,
    subject: `${count}: ${hearings.map((h) => timeLabel(h.scheduledAt)).join(', ')}`,
    text: `${title}\n\n${textItems}\n\nOpen CaseMate: ${clientUrl}`,
    html: emailLayout(title, `<ol style="padding-left:20px">${htmlItems}</ol>`),
  };
}

// Sent from Settings so the lawyer can check that email reaches their inbox.
export function testReminderEmail(to: string, name: string, clientUrl: string): MailMessage {
  const title = 'Your CaseMate test reminder';
  const body =
    'This is a test from Settings. Hearing reminders and your daily summary will arrive at this address.';
  return {
    to,
    subject: 'CaseMate test reminder',
    text: `Hello ${name},\n\n${body}\n\nOpen CaseMate: ${clientUrl}`,
    html: emailLayout(
      title,
      `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(body)}</p>${buttonHtml(clientUrl, 'Open CaseMate')}`,
    ),
  };
}

export const testReminderSms = () =>
  'CaseMate: This is a test SMS from Settings. Your hearing reminders will arrive at this number.';

// SMS text is kept short: one or two segments.
function smsText(prefix: string, h: HearingInfo): string {
  const parts = [
    `CaseMate: ${prefix} ${timeLabel(h.scheduledAt)}`,
    `${h.case.title} (${h.case.caseNumber})`,
    court(h),
    h.purpose ? `Purpose: ${h.purpose}` : null,
    h.notes ? `Note: ${h.notes}` : null,
  ].filter(Boolean);
  const text = parts.join(' | ');
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

export const dayBeforeSms = (h: HearingInfo) =>
  smsText(`Hearing tomorrow ${formatIst(h.scheduledAt, 'd MMM')},`, h);

export const twoHourSms = (h: HearingInfo) => smsText('Hearing today at', h);
