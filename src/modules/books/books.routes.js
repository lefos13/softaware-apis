/**
 * Why this exists: the Books router isolates manuscript-editing endpoints so
 * document-specific flows can grow without being mixed into PDF/image routes.
 */
import { Router } from 'express';
import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import { booksDocxUpload } from './books.upload.js';
import { applyGreekEditorController } from './books.controller.js';

const booksRouter = Router();

booksRouter.post(
  '/greek-editor/apply',
  initializeTaskProgress('books_greek_editor_apply'),
  booksDocxUpload.array('files'),
  applyGreekEditorController,
);

export { booksRouter };
