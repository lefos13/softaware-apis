/*
 * The Books router exposes both manuscript uploads and pasted-text editing so
 * the same rule catalog can serve editors who work inside or outside Word.
 */
import { Router } from 'express';
import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import { booksDocxUpload } from './books.upload.js';
import {
  applyGreekEditorController,
  applyGreekEditorTextController,
  previewGreekEditorReportController,
} from './books.controller.js';

const booksRouter = Router();

booksRouter.post(
  '/greek-editor/apply',
  initializeTaskProgress('books_greek_editor_apply'),
  booksDocxUpload.array('files'),
  applyGreekEditorController,
);

booksRouter.post(
  '/greek-editor/apply-text',
  initializeTaskProgress('books_greek_editor_apply_text'),
  applyGreekEditorTextController,
);

booksRouter.post(
  '/greek-editor/preview-report',
  initializeTaskProgress('books_greek_editor_preview_report'),
  booksDocxUpload.array('files'),
  previewGreekEditorReportController,
);

export { booksRouter };
