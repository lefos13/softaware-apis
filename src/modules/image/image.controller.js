/**
 * Why this exists: controller validates mode/options payload, updates existing
 * task progress, and emits a single ZIP download for multi-image compression.
 */
import { ApiError } from '../../common/utils/api-error.js';
import { buildResponseMeta } from '../../common/utils/api-response.js';
import {
  completeTaskProgress,
  failTaskProgress,
  updateTaskProgress,
} from '../../common/services/task-progress-store.js';
import { env } from '../../config/env.js';
import { compressImageBuffers } from './image.service.js';

function parseAdvancedOptions(rawAdvancedOptions) {
  if (!rawAdvancedOptions) {
    return {};
  }

  const parsed =
    typeof rawAdvancedOptions === 'string' ? JSON.parse(rawAdvancedOptions) : rawAdvancedOptions;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_ADVANCED_OPTIONS', 'advancedOptions must be a JSON object');
  }

  return parsed;
}

export async function compressImagesController(req, res, next) {
  const taskId = req.taskId;

  try {
    const files = req.files;

    if (!files || files.length === 0) {
      throw new ApiError(400, 'INVALID_INPUT', 'Upload at least one image file in field "files"', {
        details: [{ field: 'files', issue: 'At least one image file is required' }],
      });
    }

    const mode = String(req.body?.mode || 'balanced').toLowerCase();

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

    let advancedOptions = {};

    try {
      advancedOptions = parseAdvancedOptions(req.body?.advancedOptions);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiError(400, 'INVALID_ADVANCED_OPTIONS', 'advancedOptions must be valid JSON', {
          details: [{ field: 'advancedOptions', issue: 'Invalid JSON' }],
        });
      }

      throw error;
    }

    const compressedZip = await compressImageBuffers(
      files,
      { mode, advancedOptions },
      (progressUpdate) => {
        updateTaskProgress(taskId, progressUpdate);
      },
    );

    completeTaskProgress(taskId, 'Compressed ZIP ready for download');

    const outputName = `compressed-images-${Date.now()}.zip`;

    buildResponseMeta(req, res);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('Content-Length', compressedZip.length);
    res.setHeader('X-Operation-Message', 'Images compressed successfully');

    res.status(200).send(Buffer.from(compressedZip));
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'Image compression failed',
    });
    next(error);
  }
}
