/*
 * The Books router exposes both manuscript uploads and pasted-text editing so
 * the same rule catalog can serve editors who work inside or outside Word.
 */
import { Router } from 'express';
import { requireTrustedClient } from '../../common/middleware/trusted-client.middleware.js';
import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import { env } from '../../config/env.js';
import {
  requireTokenDashboardAccess,
  resolveServiceAccessPlan,
} from '../access/access-plan.middleware.js';
import { ACCESS_TOKEN_SERVICE_FLAGS } from '../admin/admin-token.constants.js';
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
  ? requireTokenDashboardAccess
  : (_req, _res, next) => next();

/*
 * Billing groups books requests by the same flow session so apply + preview
 * for one user run consume quota once, while older clients still fall back
 * to task id based grouping.
 */
const resolveBooksBillingKey = (req) =>
  String(
    req.query?.flowSessionId ||
      req.get('x-flow-session-id') ||
      req.query?.taskId ||
      req.get('x-task-id') ||
      '',
  ).trim();

booksRouter.get(
  '/greek-editor/access',
  requireBooksEditorAccess,
  validateGreekEditorAccessController,
);

booksRouter.post(
  '/greek-editor/apply',
  resolveServiceAccessPlan(
    ACCESS_TOKEN_SERVICE_FLAGS.BOOKS_GREEK_EDITOR,
    'books_greek_editor_apply',
    { billingKeyResolver: resolveBooksBillingKey },
  ),
  initializeTaskProgress('books_greek_editor_apply'),
  booksDocxUpload.array('files'),
  applyGreekEditorController,
);

booksRouter.post(
  '/greek-editor/apply-text',
  resolveServiceAccessPlan(
    ACCESS_TOKEN_SERVICE_FLAGS.BOOKS_GREEK_EDITOR,
    'books_greek_editor_apply_text',
    { billingKeyResolver: resolveBooksBillingKey },
  ),
  initializeTaskProgress('books_greek_editor_apply_text'),
  applyGreekEditorTextController,
);

booksRouter.post(
  '/greek-editor/preview-report',
  resolveServiceAccessPlan(
    ACCESS_TOKEN_SERVICE_FLAGS.BOOKS_GREEK_EDITOR,
    'books_greek_editor_preview_report',
    { billingKeyResolver: resolveBooksBillingKey },
  ),
  initializeTaskProgress('books_greek_editor_preview_report'),
  booksDocxUpload.array('files'),
  previewGreekEditorReportController,
);

export { booksRouter };
