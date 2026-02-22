/**
 * Why this exists: controller validates merge-plan payloads, updates existing
 * task progress, and preserves binary output with correlation metadata.
 */
import { ApiError } from '../../common/utils/api-error.js';
import { buildResponseMeta } from '../../common/utils/api-response.js';
import {
  completeTaskProgress,
  failTaskProgress,
  updateTaskProgress,
} from '../../common/services/task-progress-store.js';
import { env } from '../../config/env.js';
import { mergePdfBuffers } from './pdf.service.js';

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
