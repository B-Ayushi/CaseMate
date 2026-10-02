import { Router } from 'express';
import {
  billingController,
  invoiceController,
  timeEntryController,
} from '../controllers/billingController.js';
import type { AppDeps } from '../lib/config.js';

// Mounted behind requireAuth at /api/time-entries.
export function timeEntryRoutes(deps: AppDeps): Router {
  const router = Router();
  const controller = timeEntryController(deps);
  router.get('/', controller.list);
  router.get('/rate', controller.rate);
  router.post('/', controller.create);
  router.put('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}

// Mounted behind requireAuth at /api/invoices.
export function invoiceRoutes(deps: AppDeps): Router {
  const router = Router();
  const controller = invoiceController(deps);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  router.get('/:id/pdf', controller.pdf);
  router.post('/:id/send', controller.send);
  router.post('/:id/mark-sent', controller.markSent);
  router.post('/:id/mark-paid', controller.markPaid);
  return router;
}

// Mounted behind requireAuth at /api/billing.
export function billingRoutes(deps: AppDeps): Router {
  const router = Router();
  router.get('/summary', billingController(deps).summary);
  return router;
}
