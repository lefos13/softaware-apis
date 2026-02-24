import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import { Router } from 'express';
import { mergePdfController, splitPdfController } from './pdf.controller.js';
import { extractPdfToDocxController } from './pdf-extract.controller.js';
import { pdfUpload } from './pdf.upload.js';

const pdfRouter = Router();

pdfRouter.post(
  '/merge',
  initializeTaskProgress('pdf_merge'),
  pdfUpload.array('files'),
  mergePdfController,
);

pdfRouter.post(
  '/split',
  initializeTaskProgress('pdf_split'),
  pdfUpload.array('files'),
  splitPdfController,
);

pdfRouter.post(
  '/extract-to-docx',
  initializeTaskProgress('pdf_extract_docx'),
  pdfUpload.array('files'),
  extractPdfToDocxController,
);

export { pdfRouter };
