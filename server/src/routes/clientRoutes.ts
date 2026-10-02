import { Router } from 'express';
import { clientController } from '../controllers/clientController.js';
import type { AppDeps } from '../lib/config.js';

// Mounted behind requireAuth.
export function clientRoutes(deps: AppDeps): Router {
  const router = Router();
  const controller = clientController(deps);

  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.put('/:id', controller.update);
  router.delete('/:id', controller.remove);
  router.post('/:id/notes', controller.addNote);
  router.delete('/:id/notes/:noteId', controller.removeNote);

  return router;
}
