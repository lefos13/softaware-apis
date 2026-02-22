/**
 * Why this exists: image compression supports both simple preset modes and
 * advanced tuning while emitting real progress updates for frontend polling.
 */
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import sharp from 'sharp';
import { ApiError } from '../../common/utils/api-error.js';

const PRESET_CONFIGS = {
  light: { quality: 88, effort: 3, maxWidth: 2560, maxHeight: 2560 },
  balanced: { quality: 75, effort: 5, maxWidth: 1920, maxHeight: 1920 },
  aggressive: { quality: 60, effort: 7, maxWidth: 1440, maxHeight: 1440 },
};

const ALLOWED_MODES = new Set(['light', 'balanced', 'aggressive', 'advanced']);
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);

const safeProgressUpdate = (onProgress, payload) => {
  if (typeof onProgress !== 'function') {
    return;
  }

  try {
    onProgress(payload);
  } catch {
    // Progress callbacks are best-effort and should never interrupt file processing.
  }
};

const toPositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const sanitizeQuality = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return null;
  }

  return parsed;
};

const sanitizeEffort = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9) {
    return null;
  }

  return parsed;
};

const baseName = (fileName) => {
  if (!fileName) {
    return 'image';
  }

  return fileName.replace(/\.[^.]+$/, '') || 'image';
};

const formatFromMime = (mimeType) => {
  const mime = String(mimeType || '').toLowerCase();

  if (mime.includes('jpeg') || mime.includes('jpg')) {
    return 'jpeg';
  }

  if (mime.includes('png')) {
    return 'png';
  }

  if (mime.includes('webp')) {
    return 'webp';
  }

  if (mime.includes('avif')) {
    return 'avif';
  }

  return 'jpeg';
};

const extensionFromFormat = (format) => {
  const byFormat = {
    jpeg: 'jpg',
    png: 'png',
    webp: 'webp',
    avif: 'avif',
  };

  return byFormat[format] || 'jpg';
};

function normalizeCompressionOptions(mode, advancedOptions) {
  if (!ALLOWED_MODES.has(mode)) {
    throw new ApiError(
      400,
      'INVALID_COMPRESSION_MODE',
      'mode must be one of light, balanced, aggressive, advanced',
      {
        details: [{ field: 'mode', issue: 'Unsupported compression mode' }],
      },
    );
  }

  if (mode !== 'advanced') {
    return {
      ...PRESET_CONFIGS[mode],
      format: null,
      lossless: false,
    };
  }

  const quality = sanitizeQuality(advancedOptions?.quality);
  const effort = sanitizeEffort(advancedOptions?.effort);
  const maxWidth = toPositiveInt(advancedOptions?.maxWidth);
  const maxHeight = toPositiveInt(advancedOptions?.maxHeight);
  const format = advancedOptions?.format ? String(advancedOptions.format).toLowerCase() : null;
  const lossless = advancedOptions?.lossless === true;

  if (quality === null) {
    throw new ApiError(
      400,
      'INVALID_ADVANCED_OPTIONS',
      'advancedOptions.quality must be an integer between 1 and 100',
      {
        details: [{ field: 'advancedOptions.quality', issue: 'Value out of allowed range' }],
      },
    );
  }

  if (effort === null) {
    throw new ApiError(
      400,
      'INVALID_ADVANCED_OPTIONS',
      'advancedOptions.effort must be an integer between 0 and 9',
      {
        details: [{ field: 'advancedOptions.effort', issue: 'Value out of allowed range' }],
      },
    );
  }

  if (maxWidth === null || maxHeight === null) {
    throw new ApiError(
      400,
      'INVALID_ADVANCED_OPTIONS',
      'advancedOptions maxWidth/maxHeight must be positive integers',
      {
        details: [{ field: 'advancedOptions', issue: 'Invalid maxWidth/maxHeight values' }],
      },
    );
  }

  if (format && !ALLOWED_FORMATS.has(format)) {
    throw new ApiError(
      400,
      'INVALID_ADVANCED_OPTIONS',
      'advancedOptions.format must be one of jpeg, png, webp, avif',
      {
        details: [{ field: 'advancedOptions.format', issue: 'Unsupported output format' }],
      },
    );
  }

  return {
    quality,
    effort,
    maxWidth,
    maxHeight,
    format,
    lossless,
  };
}

function toSharpFormatOptions(format, options) {
  if (format === 'jpeg') {
    return { quality: options.quality, mozjpeg: true };
  }

  if (format === 'png') {
    const compressionLevel = Math.min(9, Math.max(0, Math.floor((100 - options.quality) / 10)));
    return { compressionLevel, palette: true };
  }

  if (format === 'avif') {
    return { quality: options.quality, effort: Math.min(9, Math.max(0, options.effort)) };
  }

  return {
    quality: options.quality,
    effort: Math.min(6, Math.max(0, options.effort)),
    lossless: options.lossless,
  };
}

async function compressSingleImage(file, options) {
  if (!file?.buffer || file.size === 0) {
    throw new ApiError(400, 'EMPTY_FILE', `Image "${file?.originalname || 'unknown'}" is empty`, {
      details: [{ field: 'files', issue: `Image "${file?.originalname || 'unknown'}" is empty` }],
    });
  }

  const sourceFormat = formatFromMime(file.mimetype);
  const outputFormat = options.format || sourceFormat;

  try {
    const transformed = await sharp(file.buffer)
      .rotate()
      .resize({
        width: options.maxWidth,
        height: options.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toFormat(outputFormat, toSharpFormatOptions(outputFormat, options))
      .toBuffer();

    return {
      fileName: `${baseName(file.originalname)}-compressed.${extensionFromFormat(outputFormat)}`,
      buffer: transformed,
    };
  } catch {
    throw new ApiError(
      422,
      'INVALID_IMAGE_CONTENT',
      `File "${file.originalname}" is not a supported image`,
      {
        details: [{ field: 'files', issue: `File "${file.originalname}" could not be processed` }],
      },
    );
  }
}

async function createZipFromEntries(entries, onProgress) {
  return new Promise((resolve, reject) => {
    const zipChunks = [];
    const passThrough = new PassThrough();

    passThrough.on('data', (chunk) => {
      zipChunks.push(chunk);
    });

    passThrough.on('end', () => {
      resolve(Buffer.concat(zipChunks));
    });

    passThrough.on('error', () => {
      reject(
        new ApiError(500, 'ZIP_ARCHIVE_FAILED', 'Failed to generate compressed image archive'),
      );
    });

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('progress', (event) => {
      const total = event?.entries?.total || entries.length;
      const processed = event?.entries?.processed || 0;
      const ratio = total > 0 ? processed / total : 0;

      safeProgressUpdate(onProgress, {
        progress: Math.min(98, Math.round(88 + ratio * 10)),
        step: 'Packaging compressed files',
        metadata: {
          archivedFiles: processed,
          totalFiles: total,
        },
      });
    });

    archive.on('error', () => {
      reject(
        new ApiError(500, 'ZIP_ARCHIVE_FAILED', 'Failed to generate compressed image archive'),
      );
    });

    archive.pipe(passThrough);

    entries.forEach((entry) => {
      archive.append(entry.buffer, { name: entry.fileName });
    });

    archive.finalize().catch(() => {
      reject(
        new ApiError(500, 'ZIP_ARCHIVE_FAILED', 'Failed to generate compressed image archive'),
      );
    });
  });
}

export async function compressImageBuffers(
  files,
  { mode = 'balanced', advancedOptions = {} } = {},
  onProgress,
) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ApiError(400, 'INVALID_INPUT', 'Upload at least one image file in field "files"', {
      details: [{ field: 'files', issue: 'At least one image file is required' }],
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 5,
    step: 'Validating compression options',
    metadata: { totalFiles: files.length },
  });

  const compressionOptions = normalizeCompressionOptions(mode, advancedOptions);
  const compressedEntries = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const compressed = await compressSingleImage(file, compressionOptions);
    compressedEntries.push(compressed);

    const ratio = (index + 1) / files.length;
    safeProgressUpdate(onProgress, {
      progress: Math.min(85, Math.round(12 + ratio * 72)),
      step: `Compressed image ${index + 1} of ${files.length}`,
      metadata: {
        currentFileIndex: index + 1,
        totalFiles: files.length,
        currentFileName: file.originalname,
      },
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 90,
    step: 'Creating download archive',
  });

  const zipBuffer = await createZipFromEntries(compressedEntries, onProgress);

  if (!zipBuffer?.length) {
    throw new ApiError(
      500,
      'IMAGE_COMPRESSION_FAILED',
      'Failed to generate compressed image archive',
    );
  }

  safeProgressUpdate(onProgress, {
    progress: 100,
    step: 'Compressed archive generated',
  });

  return zipBuffer;
}
