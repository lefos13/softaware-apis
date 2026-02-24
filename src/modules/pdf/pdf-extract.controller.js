/**
 * Why this exists: extraction controller validates OCR options, keeps progress
 * reporting aligned with other flows, and returns direct DOCX downloads.
 */
import { ApiError } from '../../common/utils/api-error.js';
import {
  completeTaskProgress,
  failTaskProgress,
  updateTaskProgress,
} from '../../common/services/task-progress-store.js';
import { buildResponseMeta } from '../../common/utils/api-response.js';
import { env } from '../../config/env.js';
import { extractPdfToDocxBuffer } from './pdf-extract.service.js';

const parseExtractOptions = (rawExtractOptions) => {
  if (!rawExtractOptions) {
    throw new ApiError(400, 'INVALID_INPUT', 'extractOptions is required', {
      details: [{ field: 'extractOptions', issue: 'Provide extraction options as JSON string' }],
    });
  }

  const parsed =
    typeof rawExtractOptions === 'string' ? JSON.parse(rawExtractOptions) : rawExtractOptions;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_EXTRACT_OPTIONS', 'extractOptions must be a JSON object', {
      details: [{ field: 'extractOptions', issue: 'Expected a JSON object payload' }],
    });
  }

  return parsed;
};

export async function extractPdfToDocxController(req, res, next) {
  const taskId = req.taskId;

  try {
    if (!env.pdfExtractToDocxEnabled) {
      throw new ApiError(404, 'FEATURE_DISABLED', 'PDF extract to DOCX is currently disabled');
    }

    const files = req.files;
    if (!files || files.length !== 1) {
      throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one PDF file in field "files"', {
        details: [{ field: 'files', issue: 'Exactly one PDF file is required' }],
      });
    }

    updateTaskProgress(taskId, {
      progress: 5,
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

    let extractOptions;

    try {
      extractOptions = parseExtractOptions(req.body?.extractOptions);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiError(400, 'INVALID_EXTRACT_OPTIONS', 'extractOptions must be valid JSON', {
          details: [{ field: 'extractOptions', issue: 'Invalid JSON' }],
        });
      }

      throw error;
    }

    const docxBuffer = await extractPdfToDocxBuffer(files[0], extractOptions, (progressUpdate) => {
      updateTaskProgress(taskId, progressUpdate);
    });

    completeTaskProgress(taskId, 'Word document ready for download');

    const outputName = `extracted-${Date.now()}.docx`;

    buildResponseMeta(req, res);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('Content-Length', docxBuffer.length);
    res.setHeader('X-Operation-Message', 'PDF text extracted to Word successfully');

    res.status(200).send(Buffer.from(docxBuffer));
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'PDF extract to DOCX failed',
    });

    next(error);
  }
}
