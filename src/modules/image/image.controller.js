/**
 * Why this exists: controller validates mode/options payload, updates existing
 * task progress, and emits a single ZIP download for multi-image compression.
 * It now includes image format conversion so both image flows share the same
 * response headers, request validation model, and task lifecycle handling.
 * A preview endpoint is included for UX-friendly single-image transparent
 * conversion previews without forcing client-side ZIP extraction.
 */
import { ApiError } from '../../common/utils/api-error.js';
import { buildResponseMeta } from '../../common/utils/api-response.js';
import {
  completeTaskProgress,
  failTaskProgress,
  updateTaskProgress,
} from '../../common/services/task-progress-store.js';
import { env } from '../../config/env.js';
import {
  compressImageBuffers,
  convertImageBuffers,
  convertSingleImageBuffer,
} from './image.service.js';

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

function parseConversionOptions(rawConversionOptions) {
  if (!rawConversionOptions) {
    return null;
  }

  const parsed =
    typeof rawConversionOptions === 'string'
      ? JSON.parse(rawConversionOptions)
      : rawConversionOptions;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'conversionOptions must be a JSON object',
    );
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

export async function convertImagesController(req, res, next) {
  const taskId = req.taskId;

  try {
    const files = req.files;

    if (!files || files.length === 0) {
      throw new ApiError(400, 'INVALID_INPUT', 'Upload at least one image file in field "files"', {
        details: [{ field: 'files', issue: 'At least one image file is required' }],
      });
    }

    const targetFormat = String(req.body?.targetFormat || '').toLowerCase();

    if (!targetFormat) {
      throw new ApiError(400, 'INVALID_TARGET_FORMAT', 'targetFormat is required', {
        details: [{ field: 'targetFormat', issue: 'Provide the desired output format' }],
      });
    }

    updateTaskProgress(taskId, {
      progress: 4,
      step: 'Upload received, validating payload',
      metadata: { totalFiles: files.length, targetFormat },
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

    let conversionOptions = null;

    try {
      conversionOptions = parseConversionOptions(req.body?.conversionOptions);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiError(
          400,
          'INVALID_CONVERSION_OPTIONS',
          'conversionOptions must be valid JSON',
          {
            details: [{ field: 'conversionOptions', issue: 'Invalid JSON' }],
          },
        );
      }

      throw error;
    }

    const convertedZip = await convertImageBuffers(
      files,
      { targetFormat, conversionOptions },
      (progressUpdate) => {
        updateTaskProgress(taskId, progressUpdate);
      },
    );

    completeTaskProgress(taskId, 'Converted ZIP ready for download');

    const outputName = `converted-images-${targetFormat}-${Date.now()}.zip`;

    buildResponseMeta(req, res);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('Content-Length', convertedZip.length);
    res.setHeader('X-Operation-Message', 'Images converted successfully');

    res.status(200).send(Buffer.from(convertedZip));
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'Image conversion failed',
    });
    next(error);
  }
}

export async function convertImagePreviewController(req, res, next) {
  const taskId = req.taskId;

  try {
    const files = req.files;

    if (!files || files.length !== 1) {
      throw new ApiError(
        400,
        'INVALID_INPUT',
        'Upload exactly one image file in field "files" for preview',
        {
          details: [{ field: 'files', issue: 'Exactly one image file is required for preview' }],
        },
      );
    }

    const targetFormat = String(req.body?.targetFormat || '').toLowerCase();

    if (!targetFormat) {
      throw new ApiError(400, 'INVALID_TARGET_FORMAT', 'targetFormat is required', {
        details: [{ field: 'targetFormat', issue: 'Provide the desired output format' }],
      });
    }

    updateTaskProgress(taskId, {
      progress: 4,
      step: 'Upload received, validating preview payload',
      metadata: { totalFiles: files.length, targetFormat },
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

    let conversionOptions = null;

    try {
      conversionOptions = parseConversionOptions(req.body?.conversionOptions);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiError(
          400,
          'INVALID_CONVERSION_OPTIONS',
          'conversionOptions must be valid JSON',
          {
            details: [{ field: 'conversionOptions', issue: 'Invalid JSON' }],
          },
        );
      }

      throw error;
    }

    const converted = await convertSingleImageBuffer(
      files[0],
      { targetFormat, conversionOptions },
      (progressUpdate) => {
        updateTaskProgress(taskId, progressUpdate);
      },
    );

    completeTaskProgress(taskId, 'Preview image ready for download');

    buildResponseMeta(req, res);
    res.setHeader('Content-Type', converted.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${converted.fileName}"`);
    res.setHeader('Content-Length', converted.buffer.length);
    res.setHeader('X-Operation-Message', 'Image preview generated successfully');

    res.status(200).send(Buffer.from(converted.buffer));
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'Image preview conversion failed',
    });
    next(error);
  }
}
