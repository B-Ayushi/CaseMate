import type { RequestHandler } from 'express';
import type { AppDeps } from '../lib/config.js';
import { currentLawyerId } from '../middleware/requireAuth.js';
import * as clientService from '../services/clientService.js';
import {
  clientBodySchema,
  clientListQuerySchema,
  clientNoteBodySchema,
  clientNoteParamsSchema,
} from '../validators/clientValidators.js';
import { idParamSchema, parseParams } from '../validators/common.js';

export function clientController({ prisma }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    const { search } = clientListQuerySchema.parse(req.query);
    const clients = await clientService.listClients(prisma, currentLawyerId(req), search);
    res.json({ clients });
  };

  const get: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    const client = await clientService.getClientProfile(prisma, currentLawyerId(req), id);
    res.json({ client });
  };

  const create: RequestHandler = async (req, res) => {
    const body = clientBodySchema.parse(req.body);
    const client = await clientService.createClient(prisma, currentLawyerId(req), body);
    res.status(201).json({ client });
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    const body = clientBodySchema.parse(req.body);
    const client = await clientService.updateClient(prisma, currentLawyerId(req), id, body);
    res.json({ client });
  };

  const remove: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    await clientService.deleteClient(prisma, currentLawyerId(req), id);
    res.status(204).end();
  };

  const addNote: RequestHandler = async (req, res) => {
    const { id } = parseParams(idParamSchema, req.params);
    const body = clientNoteBodySchema.parse(req.body);
    const note = await clientService.addClientNote(prisma, currentLawyerId(req), id, body);
    res.status(201).json({ note });
  };

  const removeNote: RequestHandler = async (req, res) => {
    const { id, noteId } = parseParams(clientNoteParamsSchema, req.params);
    await clientService.deleteClientNote(prisma, currentLawyerId(req), id, noteId);
    res.status(204).end();
  };

  return { list, get, create, update, remove, addNote, removeNote };
}
