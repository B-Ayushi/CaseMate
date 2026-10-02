import { Router } from 'express';
import { caseController, hearingController } from '../controllers/caseController.js';
import type { AppDeps } from '../lib/config.js';

// Mounted behind requireAuth.
export function caseRoutes(deps: AppDeps): Router {
  const router = Router();
  const controller = caseController(deps);

  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.put('/:id', controller.update);
  router.delete('/:id', controller.remove);
  router.post('/:id/hearings', controller.addHearing);

  return router;
}

// Mounted behind requireAuth.
export function hearingRoutes(deps: AppDeps): Router {
  const router = Router();
  const controller = hearingController(deps);

  router.get('/', controller.list);
  router.get('/missing-outcome', controller.missingOutcome);
  router.put('/:id', controller.update);
  router.post('/:id/cancel', controller.cancel);
  router.post('/:id/outcome', controller.outcome);

  return router;
}
