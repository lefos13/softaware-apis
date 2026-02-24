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
