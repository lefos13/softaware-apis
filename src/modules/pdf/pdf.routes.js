import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import { Router } from 'express';
import { mergePdfController, splitPdfController } from './pdf.controller.js';
import { extractPdfToDocxController } from './pdf-extract.controller.js';
import {
  addPageNumbersController,
  editPagesController,
  extractTextController,
  fromImagesController,
  watermarkPdfController,
} from './pdf-advanced.controller.js';
import { pdfFromImagesUpload, pdfUpload, pdfWatermarkUpload } from './pdf.upload.js';

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

pdfRouter.post(
  '/watermark',
  initializeTaskProgress('pdf_watermark'),
  pdfWatermarkUpload.any(),
  watermarkPdfController,
);

pdfRouter.post(
  '/page-numbers',
  initializeTaskProgress('pdf_page_numbers'),
  pdfUpload.array('files'),
  addPageNumbersController,
);

pdfRouter.post(
  '/edit-pages',
  initializeTaskProgress('pdf_edit_pages'),
  pdfUpload.array('files'),
  editPagesController,
);

pdfRouter.post(
  '/extract-text',
  initializeTaskProgress('pdf_extract_text'),
  pdfUpload.array('files'),
  extractTextController,
);

pdfRouter.post(
  '/from-images',
  initializeTaskProgress('pdf_from_images'),
  pdfFromImagesUpload.array('files'),
  fromImagesController,
);

export { pdfRouter };
