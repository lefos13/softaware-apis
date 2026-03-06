/*
 * Advanced PDF controllers keep multipart parsing and option validation close
 * to transport concerns while delegating document transformations to services.
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
  addPdfPageNumbers,
  addPdfWatermark,
  buildPdfFromImages,
  editPdfPages,
  extractPdfTextAsTxt,
} from './pdf-advanced.service.js';

const ensureTotalSizeLimit = (files) => {
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
};

const parseJsonObject = ({ rawValue, fieldName, required = false }) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    if (required) {
      throw new ApiError(400, 'INVALID_INPUT', `${fieldName} is required`, {
        details: [{ field: fieldName, issue: 'Provide a JSON object payload' }],
      });
    }

    return {};
  }

  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(400, 'INVALID_INPUT', `${fieldName} must be a JSON object`, {
        details: [{ field: fieldName, issue: 'Expected object payload' }],
      });
    }

    return parsed;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(400, 'INVALID_INPUT', `${fieldName} must be valid JSON`, {
      details: [{ field: fieldName, issue: 'Invalid JSON' }],
    });
  }
};

const getSinglePdfFile = (files) => {
  if (!Array.isArray(files) || files.length !== 1) {
    throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one PDF file in field "files"', {
      details: [{ field: 'files', issue: 'Exactly one PDF file is required' }],
    });
  }

  return files[0];
};

const sendPdfBinary = ({ req, res, buffer, fileName, message }) => {
  buildResponseMeta(req, res);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('X-Operation-Message', message);
  res.status(200).send(Buffer.from(buffer));
};

export async function watermarkPdfController(req, res, next) {
  const taskId = req.taskId;

  try {
    const files = req.files || [];
    const sourceFile = getSinglePdfFile(files.filter((file) => file.fieldname === 'files'));
    const watermarkImageFile = files.find((file) => file.fieldname === 'watermarkImage');
    ensureTotalSizeLimit(files);

    const watermarkOptions = parseJsonObject({
      rawValue: req.body?.watermarkOptions,
      fieldName: 'watermarkOptions',
    });

    updateTaskProgress(taskId, {
      progress: 5,
      step: 'Upload received, validating watermark payload',
      metadata: { hasWatermarkImage: Boolean(watermarkImageFile) },
    });

    const out = await addPdfWatermark(
      { file: sourceFile, watermarkOptions, watermarkImageFile },
      (progressUpdate) => updateTaskProgress(taskId, progressUpdate),
    );

    completeTaskProgress(taskId, 'Watermarked PDF ready for download');
    sendPdfBinary({
      req,
      res,
      buffer: out,
      fileName: `watermarked-${Date.now()}.pdf`,
      message: 'PDF watermark applied successfully',
    });
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'PDF watermark failed',
    });
    next(error);
  }
}

export async function addPageNumbersController(req, res, next) {
  const taskId = req.taskId;

  try {
    const files = req.files || [];
    const sourceFile = getSinglePdfFile(files);
    ensureTotalSizeLimit(files);

    const pageNumberOptions = parseJsonObject({
      rawValue: req.body?.pageNumberOptions,
      fieldName: 'pageNumberOptions',
    });

    updateTaskProgress(taskId, {
      progress: 5,
      step: 'Upload received, validating numbering payload',
      metadata: { mode: pageNumberOptions.mode || 'page_numbers' },
    });

    const out = await addPdfPageNumbers({ file: sourceFile, pageNumberOptions }, (progressUpdate) =>
      updateTaskProgress(taskId, progressUpdate),
    );

    completeTaskProgress(taskId, 'Numbered PDF ready for download');
    sendPdfBinary({
      req,
      res,
      buffer: out,
      fileName: `numbered-${Date.now()}.pdf`,
      message: 'PDF page numbers applied successfully',
    });
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'PDF page numbering failed',
    });
    next(error);
  }
}

export async function editPagesController(req, res, next) {
  const taskId = req.taskId;

  try {
    const files = req.files || [];
    const sourceFile = getSinglePdfFile(files);
    ensureTotalSizeLimit(files);

    const editPlan = parseJsonObject({
      rawValue: req.body?.editPlan,
      fieldName: 'editPlan',
      required: true,
    });

    updateTaskProgress(taskId, {
      progress: 5,
      step: 'Upload received, validating edit plan',
      metadata: {
        hasKeep: Array.isArray(editPlan.keep),
        hasDelete: Array.isArray(editPlan.delete),
        hasReorder: Array.isArray(editPlan.reorder),
      },
    });

    const out = await editPdfPages({ file: sourceFile, editPlan }, (progressUpdate) =>
      updateTaskProgress(taskId, progressUpdate),
    );

    completeTaskProgress(taskId, 'Edited PDF ready for download');
    sendPdfBinary({
      req,
      res,
      buffer: out,
      fileName: `edited-${Date.now()}.pdf`,
      message: 'PDF pages edited successfully',
    });
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'PDF page editing failed',
    });
    next(error);
  }
}

export async function extractTextController(req, res, next) {
  const taskId = req.taskId;

  try {
    const files = req.files || [];
    const sourceFile = getSinglePdfFile(files);
    ensureTotalSizeLimit(files);

    const textExtractOptions = parseJsonObject({
      rawValue: req.body?.textExtractOptions,
      fieldName: 'textExtractOptions',
    });

    updateTaskProgress(taskId, {
      progress: 5,
      step: 'Upload received, preparing text extraction',
      metadata: { perPageZip: textExtractOptions.perPageZip === true },
    });

    const out = await extractPdfTextAsTxt(
      { file: sourceFile, textExtractOptions },
      (progressUpdate) => updateTaskProgress(taskId, progressUpdate),
    );

    completeTaskProgress(taskId, 'Extracted text ready for download');

    buildResponseMeta(req, res);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
    res.setHeader('Content-Length', out.buffer.length);
    res.setHeader('X-Operation-Message', 'PDF text extracted successfully');
    res.status(200).send(Buffer.from(out.buffer));
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'PDF text extraction failed',
    });
    next(error);
  }
}

export async function fromImagesController(req, res, next) {
  const taskId = req.taskId;

  try {
    const files = req.files || [];
    if (!Array.isArray(files) || files.length === 0) {
      throw new ApiError(400, 'INVALID_INPUT', 'Upload at least one image in field "files"', {
        details: [{ field: 'files', issue: 'At least one image file is required' }],
      });
    }

    ensureTotalSizeLimit(files);

    updateTaskProgress(taskId, {
      progress: 5,
      step: 'Upload received, preparing image pages',
      metadata: { totalFiles: files.length },
    });

    const out = await buildPdfFromImages(files, (progressUpdate) =>
      updateTaskProgress(taskId, progressUpdate),
    );

    completeTaskProgress(taskId, 'PDF generated from images and ready for download');
    sendPdfBinary({
      req,
      res,
      buffer: out,
      fileName: `from-images-${Date.now()}.pdf`,
      message: 'PDF generated from images successfully',
    });
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'PDF generation from images failed',
    });
    next(error);
  }
}
