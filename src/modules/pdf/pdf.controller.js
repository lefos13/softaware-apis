/**
 * Why this exists: controller validates merge-plan payloads, updates existing
 * task progress, and preserves binary output with correlation metadata.
 * It now also supports PDF split requests with mode-specific options.
 */
import { ApiError } from '../../common/utils/api-error.js';
import { buildResponseMeta } from '../../common/utils/api-response.js';
import {
  completeTaskProgress,
  failTaskProgress,
  updateTaskProgress,
} from '../../common/services/task-progress-store.js';
import { env } from '../../config/env.js';
import { mergePdfBuffers, splitPdfBuffer } from './pdf.service.js';

function parseMergePlan(rawMergePlan) {
  if (!rawMergePlan) {
    return [];
  }

  const parsed = typeof rawMergePlan === 'string' ? JSON.parse(rawMergePlan) : rawMergePlan;

  if (!Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_MERGE_PLAN', 'mergePlan must be a JSON array');
  }

  return parsed;
}

function parseSplitOptions(rawSplitOptions) {
  if (!rawSplitOptions) {
    return {};
  }

  const parsed =
    typeof rawSplitOptions === 'string' ? JSON.parse(rawSplitOptions) : rawSplitOptions;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_SPLIT_OPTIONS', 'splitOptions must be a JSON object');
  }

  return parsed;
}

export async function mergePdfController(req, res, next) {
  const taskId = req.taskId;

  try {
    const files = req.files;

    if (!files || files.length < 2) {
      throw new ApiError(400, 'INVALID_INPUT', 'Upload at least 2 PDF files in field "files"', {
        details: [{ field: 'files', issue: 'At least 2 PDF files are required' }],
      });
    }

    updateTaskProgress(taskId, {
      progress: 4,
      step: 'Upload received, validating payload',
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

    let mergePlan = [];

    try {
      mergePlan = parseMergePlan(req.body?.mergePlan);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiError(400, 'INVALID_MERGE_PLAN', 'mergePlan must be valid JSON', {
          details: [{ field: 'mergePlan', issue: 'Invalid JSON' }],
        });
      }

      throw error;
    }

    const mergedPdf = await mergePdfBuffers(files, mergePlan, (progressUpdate) => {
      updateTaskProgress(taskId, progressUpdate);
    });

    completeTaskProgress(taskId, 'Merged PDF ready for download');

    const outputName = `merged-${Date.now()}.pdf`;

    buildResponseMeta(req, res);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('Content-Length', mergedPdf.length);
    res.setHeader('X-Operation-Message', 'PDF files merged successfully');

    res.status(200).send(Buffer.from(mergedPdf));
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'PDF merge failed',
    });
    next(error);
  }
}

export async function splitPdfController(req, res, next) {
  const taskId = req.taskId;

  try {
    const files = req.files;
    if (!files || files.length !== 1) {
      throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one PDF file in field "files"', {
        details: [{ field: 'files', issue: 'Exactly one PDF file is required' }],
      });
    }

    const mode = String(req.body?.mode || '').toLowerCase();
    if (!mode) {
      throw new ApiError(400, 'INVALID_SPLIT_MODE', 'mode is required', {
        details: [{ field: 'mode', issue: 'Choose a split mode' }],
      });
    }

    updateTaskProgress(taskId, {
      progress: 4,
      step: 'Upload received, validating payload',
      metadata: { totalFiles: files.length, mode },
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

    let splitOptions = {};
    try {
      splitOptions = parseSplitOptions(req.body?.splitOptions);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiError(400, 'INVALID_SPLIT_OPTIONS', 'splitOptions must be valid JSON', {
          details: [{ field: 'splitOptions', issue: 'Invalid JSON' }],
        });
      }
      throw error;
    }

    const zipBuffer = await splitPdfBuffer(files[0], { mode, splitOptions }, (progressUpdate) => {
      updateTaskProgress(taskId, progressUpdate);
    });

    completeTaskProgress(taskId, 'Split ZIP ready for download');

    const outputName = `split-pdf-${Date.now()}.zip`;
    buildResponseMeta(req, res);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.setHeader('X-Operation-Message', 'PDF split completed successfully');
    res.status(200).send(Buffer.from(zipBuffer));
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'PDF split failed',
    });
    next(error);
  }
}
