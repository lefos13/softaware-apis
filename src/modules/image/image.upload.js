/**
 * Why this exists: image upload constraints are isolated so MIME filtering and
 * request-size limits stay consistent with PDF and easy to tune centrally.
 * Upload support now includes GIF/TIFF so conversion can accept more sources
 * while preserving one shared image validation layer for all image endpoints.
 */
import multer from 'multer';
import { env } from '../../config/env.js';
import { ApiError } from '../../common/utils/api-error.js';

const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  const allowedMime = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/tiff',
  ]);

  if (!allowedMime.has(file.mimetype)) {
    return cb(
      new ApiError(
        400,
        'INVALID_FILE_TYPE',
        'Only JPEG, PNG, WEBP, AVIF, GIF, and TIFF images are allowed',
      ),
    );
  }

  cb(null, true);
};

export const imageUpload = multer({
  storage,
  fileFilter,
  limits: {
    files: env.maxUploadFiles,
    fileSize: env.maxFileSizeBytes,
  },
});
