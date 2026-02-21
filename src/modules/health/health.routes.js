/**
 * Why this exists: health responses now follow the same success envelope used
 * across APIs so frontend status rendering is uniform.
 */
import { Router } from 'express';
import { sendSuccess } from '../../common/utils/api-response.js';

const healthRouter = Router();

healthRouter.get('/', (req, res) => {
  sendSuccess(res, req, {
    message: 'Service is healthy',
    data: { status: 'ok' },
  });
});

export { healthRouter };
