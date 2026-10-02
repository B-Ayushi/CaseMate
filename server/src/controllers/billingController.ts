import type { RequestHandler } from 'express';
import type { AppDeps } from '../lib/config.js';
import { currentLawyerId } from '../middleware/requireAuth.js';
import { billingSummary } from '../services/billingService.js';
import * as invoiceService from '../services/invoiceService.js';
import * as timeEntryService from '../services/timeEntryService.js';
import {
  createInvoiceSchema,
  createTimeEntrySchema,
  invoiceListQuerySchema,
  monthQuerySchema,
  rateQuerySchema,
  timeEntryListQuerySchema,
  updateInvoiceSchema,
  updateTimeEntrySchema,
} from '../validators/billingValidators.js';
import { idParamSchema, parseParams } from '../validators/common.js';

export function timeEntryController({ prisma }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    const query = timeEntryListQuerySchema.parse(req.query);
    res.json({
      timeEntries: await timeEntryService.listTimeEntries(prisma, currentLawyerId(req), query),
    });
  };

  const rate: RequestHandler = async (req, res) => {
    const { caseId } = rateQuerySchema.parse(req.query);
    res.json({ rate: await timeEntryService.rateForCase(prisma, currentLawyerId(req), caseId) });
  };

  const create: RequestHandler = async (req, res) => {
    const input = createTimeEntrySchema.parse(req.body);
    const timeEntry = await timeEntryService.createTimeEntry(prisma, currentLawyerId(req), input);
    res.status(201).json({ timeEntry });
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    const input = updateTimeEntrySchema.parse(req.body);
    res.json({
      timeEntry: await timeEntryService.updateTimeEntry(prisma, currentLawyerId(req), id, input),
    });
  };

  const remove: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    await timeEntryService.deleteTimeEntry(prisma, currentLawyerId(req), id);
    res.status(204).end();
  };

  return { list, rate, create, update, remove };
}

export function invoiceController({ prisma, mailer }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    const filter = invoiceListQuerySchema.parse(req.query);
    res.json({ invoices: await invoiceService.listInvoices(prisma, currentLawyerId(req), filter) });
  };

  const get: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    res.json({ invoice: await invoiceService.getInvoice(prisma, currentLawyerId(req), id) });
  };

  const create: RequestHandler = async (req, res) => {
    const input = createInvoiceSchema.parse(req.body);
    const invoice = await invoiceService.createInvoice(prisma, currentLawyerId(req), input);
    res.status(201).json({ invoice });
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    const input = updateInvoiceSchema.parse(req.body);
    res.json({
      invoice: await invoiceService.updateInvoice(prisma, currentLawyerId(req), id, input),
    });
  };

  const remove: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    await invoiceService.deleteDraft(prisma, currentLawyerId(req), id);
    res.status(204).end();
  };

  const pdf: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    const { pdf: file, filename } = await invoiceService.invoicePdf(
      prisma,
      currentLawyerId(req),
      id,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file);
  };

  const send: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    res.json({
      invoice: await invoiceService.sendInvoice({ prisma, mailer }, currentLawyerId(req), id),
    });
  };

  const markSent: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    res.json({ invoice: await invoiceService.markSent(prisma, currentLawyerId(req), id) });
  };

  const markPaid: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    res.json({ invoice: await invoiceService.markPaid(prisma, currentLawyerId(req), id) });
  };

  return { list, get, create, update, remove, pdf, send, markSent, markPaid };
}

export function billingController({ prisma }: AppDeps) {
  const summary: RequestHandler = async (req, res) => {
    const { month } = monthQuerySchema.parse(req.query);
    res.json({ summary: await billingSummary(prisma, currentLawyerId(req), month) });
  };
  return { summary };
}
