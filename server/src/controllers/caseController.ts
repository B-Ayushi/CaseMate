import type { RequestHandler } from 'express';
import type { AppDeps } from '../lib/config.js';
import { currentLawyerId } from '../middleware/requireAuth.js';
import * as caseService from '../services/caseService.js';
import * as hearingService from '../services/hearingService.js';
import {
  caseListQuerySchema,
  createCaseSchema,
  hearingRangeQuerySchema,
  hearingSlotSchema,
  outcomeSchema,
  updateCaseSchema,
} from '../validators/caseValidators.js';
import { idParamSchema, parseParams } from '../validators/common.js';

export function caseController({ prisma }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    const filter = caseListQuerySchema.parse(req.query);
    res.json({ cases: await caseService.listCases(prisma, currentLawyerId(req), filter) });
  };

  const get: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    res.json({ case: await caseService.getCase(prisma, currentLawyerId(req), id) });
  };

  const create: RequestHandler = async (req, res) => {
    const body = createCaseSchema.parse(req.body);
    const legalCase = await caseService.createCase(prisma, currentLawyerId(req), body);
    res.status(201).json({ case: legalCase });
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    const body = updateCaseSchema.parse(req.body);
    res.json({ case: await caseService.updateCase(prisma, currentLawyerId(req), id, body) });
  };

  const remove: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    await caseService.deleteCase(prisma, currentLawyerId(req), id);
    res.status(204).end();
  };

  const addHearing: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    const slot = hearingSlotSchema.parse(req.body);
    const hearing = await hearingService.addHearing(prisma, currentLawyerId(req), id, slot);
    res.status(201).json({ hearing });
  };

  return { list, get, create, update, remove, addHearing };
}

export function hearingController({ prisma }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    const range = hearingRangeQuerySchema.parse(req.query);
    res.json({ hearings: await hearingService.listHearings(prisma, currentLawyerId(req), range) });
  };

  const missingOutcome: RequestHandler = async (req, res) => {
    res.json({
      hearings: await hearingService.hearingsMissingOutcome(prisma, currentLawyerId(req)),
    });
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    const slot = hearingSlotSchema.parse(req.body);
    res.json({
      hearing: await hearingService.updateHearing(prisma, currentLawyerId(req), id, slot),
    });
  };

  const cancel: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    res.json({ hearing: await hearingService.cancelHearing(prisma, currentLawyerId(req), id) });
  };

  const outcome: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    const body = outcomeSchema.parse(req.body);
    res.json(await hearingService.logOutcome(prisma, currentLawyerId(req), id, body));
  };

  return { list, missingOutcome, update, cancel, outcome };
}
