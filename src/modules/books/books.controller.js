/**
 * Why this exists: the controller keeps the new book-editing flow aligned
 * with shared validation, task progress, and binary-download response rules.
 */
import { basename } from 'node:path';
import {
  completeTaskProgress,
  failTaskProgress,
  updateTaskProgress,
} from '../../common/services/task-progress-store.js';
import { buildResponseMeta } from '../../common/utils/api-response.js';
import { ApiError } from '../../common/utils/api-error.js';
import { env } from '../../config/env.js';
import { applyGreekEditorToDocxBuffer } from './books.service.js';
import { normalizeBooksEditorOptions } from './books.rules.js';

const parseEditorOptions = (rawEditorOptions) => {
  if (!rawEditorOptions) {
    throw new ApiError(400, 'INVALID_EDITOR_OPTIONS', 'editorOptions is required', {
      details: [{ field: 'editorOptions', issue: 'Provide editor options as a JSON string' }],
    });
  }

  const parsed =
    typeof rawEditorOptions === 'string' ? JSON.parse(rawEditorOptions) : rawEditorOptions;

  return normalizeBooksEditorOptions(parsed);
};

const repairIncomingFileName = (value) => {
  const text = String(value || '');

  if (!/[ÎÏÃÐÑ]/.test(text)) {
    return text;
  }

  try {
    return Buffer.from(text, 'latin1').toString('utf8');
  } catch {
    return text;
  }
};

const buildOutputName = (originalName) => {
  const normalizedName = repairIncomingFileName(originalName || 'manuscript.docx');
  const baseName = String(basename(normalizedName)).replace(/\.docx$/i, '');
  return `${baseName || 'manuscript'}-edited.docx`;
};

/*
 * Content-Disposition needs both an ASCII fallback and an RFC 5987 filename*
 * value so Greek manuscript names download correctly across browsers/clients.
 */
const buildContentDisposition = (fileName) => {
  const asciiFallback = fileName
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encodedFileName = encodeURIComponent(fileName);

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
};

export async function applyGreekEditorController(req, res, next) {
  const taskId = req.taskId;

  try {
    if (!env.booksGreekEditorEnabled) {
      throw new ApiError(404, 'FEATURE_DISABLED', 'Greek literature editor is currently disabled');
    }

    const files = req.files;
    if (!files || files.length !== 1) {
      throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one DOCX file in field "files"', {
        details: [{ field: 'files', issue: 'Exactly one DOCX file is required' }],
      });
    }

    updateTaskProgress(taskId, {
      progress: 5,
      step: 'Upload received, validating manuscript',
      metadata: { totalFiles: files.length },
    });

    const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
    if (totalBytes > env.maxTotalUploadBytes) {
      throw new ApiError(413, 'TOTAL_UPLOAD_TOO_LARGE', 'Total upload size exceeds allowed limit', {
        details: [
          {
            field: 'files',
            issue: `Combined file size must be <= ${Math.floor(env.maxTotalUploadBytes / (1024 * 1024))} MB`,
          },
        ],
      });
    }

    let editorOptions;
    try {
      editorOptions = parseEditorOptions(req.body?.editorOptions);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiError(400, 'INVALID_EDITOR_OPTIONS', 'editorOptions must be valid JSON', {
          details: [{ field: 'editorOptions', issue: 'Invalid JSON' }],
        });
      }

      throw error;
    }

    const { buffer, summary } = await applyGreekEditorToDocxBuffer(
      files[0],
      editorOptions,
      (progressUpdate) => {
        updateTaskProgress(taskId, progressUpdate);
      },
    );

    updateTaskProgress(taskId, {
      progress: 99,
      step: 'Finalizing corrected manuscript',
      metadata: summary,
    });

    completeTaskProgress(taskId, 'Corrected manuscript ready for download');

    buildResponseMeta(req, res);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(buildOutputName(files[0].originalname)),
    );
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('X-Operation-Message', 'Greek literature corrections applied successfully');

    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'Greek literature editor failed',
    });

    next(error);
  }
}
