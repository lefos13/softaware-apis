/**
 * Why this exists: single route composition point keeps module boundaries
 * explicit and makes future domain expansion straightforward.
 */
import { Router } from 'express';
import { accessRouter } from '../modules/access/access.routes.js';
import { adminRouter } from '../modules/admin/admin.routes.js';
import { booksRouter } from '../modules/books/books.routes.js';
import { healthRouter } from '../modules/health/health.routes.js';
import { imageRouter } from '../modules/image/image.routes.js';
import { pdfRouter } from '../modules/pdf/pdf.routes.js';
import { tasksRouter } from '../modules/tasks/tasks.routes.js';
import { utilsRouter } from '../modules/utils/utils.routes.js';

const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/access', accessRouter);
apiRouter.use('/pdf', pdfRouter);
apiRouter.use('/image', imageRouter);
apiRouter.use('/books', booksRouter);
apiRouter.use('/tasks', tasksRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/utils', utilsRouter);

export { apiRouter };
