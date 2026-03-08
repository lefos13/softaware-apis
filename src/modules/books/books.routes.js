/*
 * The Books router exposes both manuscript uploads and pasted-text editing so
 * the same rule catalog can serve editors who work inside or outside Word.
 */
import { Router } from 'express';
import { requireTrustedClient } from '../../common/middleware/trusted-client.middleware.js';
import { requireServiceTokenAccess } from '../admin/admin-auth.middleware.js';
import { ACCESS_TOKEN_SERVICE_FLAGS } from '../admin/admin-token.constants.js';
import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import { env } from '../../config/env.js';
import { booksDocxUpload } from './books.upload.js';
import {
  applyGreekEditorController,
  applyGreekEditorTextController,
  previewGreekEditorReportController,
  validateGreekEditorAccessController,
} from './books.controller.js';

const booksRouter = Router();

booksRouter.use(requireTrustedClient);

/*
 * Non-production environments can bypass editor token checks for local QA,
 * while production always enforces the service-token middleware from env.js.
 */
const requireBooksEditorAccess = env.booksEditorTokenAuthEnabled
  ? requireServiceTokenAccess(ACCESS_TOKEN_SERVICE_FLAGS.BOOKS_GREEK_EDITOR)
  : (_req, _res, next) => next();

booksRouter.get(
  '/greek-editor/access',
  requireBooksEditorAccess,
  validateGreekEditorAccessController,
);

booksRouter.post(
  '/greek-editor/apply',
  requireBooksEditorAccess,
  initializeTaskProgress('books_greek_editor_apply'),
  booksDocxUpload.array('files'),
  applyGreekEditorController,
);

booksRouter.post(
  '/greek-editor/apply-text',
  requireBooksEditorAccess,
  initializeTaskProgress('books_greek_editor_apply_text'),
  applyGreekEditorTextController,
);

booksRouter.post(
  '/greek-editor/preview-report',
  requireBooksEditorAccess,
  initializeTaskProgress('books_greek_editor_preview_report'),
  booksDocxUpload.array('files'),
  previewGreekEditorReportController,
);

export { booksRouter };
