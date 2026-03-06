/**
 * Why this exists: upload concerns are isolated from controller logic so
 * file count/size/type limits can evolve safely in one module.
 */
import multer from 'multer';
import { env } from '../../config/env.js';
import { ApiError } from '../../common/utils/api-error.js';

const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  const isPdfMime = file.mimetype === 'application/pdf';
  const isPdfName =
    typeof file.originalname === 'string' && file.originalname.toLowerCase().endsWith('.pdf');

  if (!isPdfMime && !isPdfName) {
    return cb(
      new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF files are allowed for this endpoint'),
    );
  }

  cb(null, true);
};

export const pdfUpload = multer({
  storage,
  fileFilter,
  limits: {
    files: env.maxUploadFiles,
    fileSize: env.maxFileSizeBytes,
  },
});

/*
 * Dedicated upload filters for new PDF utilities allow mixed watermark assets
 * and image-to-PDF inputs without loosening validation for core PDF endpoints.
 */
const allowedImageMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/tiff',
]);

const watermarkFileFilter = (_req, file, cb) => {
  if (file.fieldname === 'files') {
    return fileFilter(_req, file, cb);
  }

  if (file.fieldname === 'watermarkImage') {
    if (!allowedImageMime.has(file.mimetype)) {
      return cb(
        new ApiError(
          415,
          'UNSUPPORTED_FILE_TYPE',
          'watermarkImage must be JPEG, PNG, WEBP, AVIF, GIF, or TIFF',
        ),
      );
    }

    return cb(null, true);
  }

  return cb(
    new ApiError(
      400,
      'UNEXPECTED_FILE_FIELD',
      'Unexpected upload field. Use "files" and optional "watermarkImage"',
    ),
  );
};

const fromImagesFileFilter = (_req, file, cb) => {
  if (!allowedImageMime.has(file.mimetype)) {
    return cb(
      new ApiError(
        415,
        'UNSUPPORTED_FILE_TYPE',
        'Only JPEG, PNG, WEBP, AVIF, GIF, and TIFF images are allowed for this endpoint',
      ),
    );
  }

  return cb(null, true);
};

export const pdfWatermarkUpload = multer({
  storage,
  fileFilter: watermarkFileFilter,
  limits: {
    files: 2,
    fileSize: env.maxFileSizeBytes,
  },
});

export const pdfFromImagesUpload = multer({
  storage,
  fileFilter: fromImagesFileFilter,
  limits: {
    files: env.maxUploadFiles,
    fileSize: env.maxFileSizeBytes,
  },
});
