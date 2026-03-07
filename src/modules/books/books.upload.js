/**
 * Why this exists: manuscript uploads need DOCX-only validation without
 * loosening the PDF and image upload guards used by the rest of the API.
 */
import multer from 'multer';
import { env } from '../../config/env.js';
import { ApiError } from '../../common/utils/api-error.js';

const storage = multer.memoryStorage();

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const booksDocxFileFilter = (_req, file, cb) => {
  const hasDocxMime = file.mimetype === DOCX_MIME;
  const hasDocxName =
    typeof file.originalname === 'string' && file.originalname.toLowerCase().endsWith('.docx');

  if (!hasDocxMime && !hasDocxName) {
    return cb(
      new ApiError(
        415,
        'UNSUPPORTED_FILE_TYPE',
        'Only DOCX files are allowed for the Greek literature editor',
      ),
    );
  }

  return cb(null, true);
};

export const booksDocxUpload = multer({
  storage,
  fileFilter: booksDocxFileFilter,
  limits: {
    files: env.maxUploadFiles,
    fileSize: env.maxFileSizeBytes,
  },
});
