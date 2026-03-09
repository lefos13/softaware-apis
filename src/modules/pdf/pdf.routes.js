import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import { requireTrustedClient } from '../../common/middleware/trusted-client.middleware.js';
import { Router } from 'express';
import { resolveServiceAccessPlan } from '../access/access-plan.middleware.js';
import { ACCESS_TOKEN_SERVICE_FLAGS } from '../admin/admin-token.constants.js';
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

pdfRouter.use(requireTrustedClient);

pdfRouter.post(
  '/merge',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.PDF, 'pdf_merge'),
  initializeTaskProgress('pdf_merge'),
  pdfUpload.array('files'),
  mergePdfController,
);

pdfRouter.post(
  '/split',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.PDF, 'pdf_split'),
  initializeTaskProgress('pdf_split'),
  pdfUpload.array('files'),
  splitPdfController,
);

pdfRouter.post(
  '/extract-to-docx',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.PDF, 'pdf_extract_docx'),
  initializeTaskProgress('pdf_extract_docx'),
  pdfUpload.array('files'),
  extractPdfToDocxController,
);

pdfRouter.post(
  '/watermark',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.PDF, 'pdf_watermark'),
  initializeTaskProgress('pdf_watermark'),
  pdfWatermarkUpload.any(),
  watermarkPdfController,
);

pdfRouter.post(
  '/page-numbers',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.PDF, 'pdf_page_numbers'),
  initializeTaskProgress('pdf_page_numbers'),
  pdfUpload.array('files'),
  addPageNumbersController,
);

pdfRouter.post(
  '/edit-pages',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.PDF, 'pdf_edit_pages'),
  initializeTaskProgress('pdf_edit_pages'),
  pdfUpload.array('files'),
  editPagesController,
);

pdfRouter.post(
  '/extract-text',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.PDF, 'pdf_extract_text'),
  initializeTaskProgress('pdf_extract_text'),
  pdfUpload.array('files'),
  extractTextController,
);

pdfRouter.post(
  '/from-images',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.PDF, 'pdf_from_images'),
  initializeTaskProgress('pdf_from_images'),
  pdfFromImagesUpload.array('files'),
  fromImagesController,
);

export { pdfRouter };
