import { Router } from 'express';
import { mergePdfController } from './pdf.controller.js';
import { pdfUpload } from './pdf.upload.js';

const pdfRouter = Router();

pdfRouter.post('/merge', pdfUpload.array('files'), mergePdfController);

export { pdfRouter };
