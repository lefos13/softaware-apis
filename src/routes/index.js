/**
 * Why this exists: single route composition point keeps module boundaries
 * explicit and makes future domain expansion straightforward.
 */
import { Router } from 'express';
import { adminRouter } from '../modules/admin/admin.routes.js';
import { healthRouter } from '../modules/health/health.routes.js';
import { imageRouter } from '../modules/image/image.routes.js';
import { pdfRouter } from '../modules/pdf/pdf.routes.js';
import { tasksRouter } from '../modules/tasks/tasks.routes.js';

const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/pdf', pdfRouter);
apiRouter.use('/image', imageRouter);
apiRouter.use('/tasks', tasksRouter);
apiRouter.use('/admin', adminRouter);

export { apiRouter };
