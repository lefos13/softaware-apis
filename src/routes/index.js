/**
 * Why this exists: single route composition point keeps module boundaries
 * explicit and makes future domain expansion straightforward.
 */
import { Router } from 'express';
import { healthRouter } from '../modules/health/health.routes.js';
import { imageRouter } from '../modules/image/image.routes.js';
import { pdfRouter } from '../modules/pdf/pdf.routes.js';

const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/pdf', pdfRouter);
apiRouter.use('/image', imageRouter);

export { apiRouter };
