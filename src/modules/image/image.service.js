/**
 * Why this exists: image compression supports both simple preset modes and
 * advanced tuning while emitting real progress updates for frontend polling.
 * It now also powers a format-conversion pipeline so image flows share one
 * consistent validation/error/progress model across compression and conversion.
 * Conversion now supports automatic and picker-seeded transparency removal so
 * web-target exports can remove flat backgrounds without manual color entry.
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
const ALLOWED_CONVERSION_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']);
const ALPHA_CAPABLE_FORMATS = new Set(['png', 'webp', 'avif', 'tiff', 'gif']);
const ALLOWED_BACKGROUND_DETECTION_MODES = new Set(['auto', 'picker']);

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

const sanitizeColorTolerance = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
    return null;
  }

  return parsed;
};

const sanitizeUnitInterval = (value) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return null;
  }

  return parsed;
};

const sanitizePickerPoint = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const x = sanitizeUnitInterval(value.x);
  const y = sanitizeUnitInterval(value.y);

  if (x === null || y === null) {
    return null;
  }

  return { x, y };
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
    tiff: 'tiff',
    gif: 'gif',
  };

  return byFormat[format] || 'jpg';
};

const mimeTypeFromFormat = (format) => {
  const byFormat = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    tiff: 'image/tiff',
    gif: 'image/gif',
  };

  return byFormat[format] || 'application/octet-stream';
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

function normalizeConversionOptions(targetFormat, conversionOptions) {
  const normalizedTargetFormat = String(targetFormat || '').toLowerCase();

  if (!ALLOWED_CONVERSION_FORMATS.has(normalizedTargetFormat)) {
    throw new ApiError(
      400,
      'INVALID_TARGET_FORMAT',
      'targetFormat must be one of jpeg, png, webp, avif, tiff, gif',
      {
        details: [{ field: 'targetFormat', issue: 'Unsupported output format' }],
      },
    );
  }

  if (conversionOptions === null || conversionOptions === undefined) {
    return {
      targetFormat: normalizedTargetFormat,
      quality: null,
      effort: null,
      lossless: false,
    };
  }

  if (typeof conversionOptions !== 'object' || Array.isArray(conversionOptions)) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'conversionOptions must be a JSON object',
      {
        details: [{ field: 'conversionOptions', issue: 'Expected object value' }],
      },
    );
  }

  const quality =
    Object.hasOwn(conversionOptions, 'quality') && conversionOptions.quality !== null
      ? sanitizeQuality(conversionOptions.quality)
      : null;
  const effort =
    Object.hasOwn(conversionOptions, 'effort') && conversionOptions.effort !== null
      ? sanitizeEffort(conversionOptions.effort)
      : null;
  const lossless = conversionOptions.lossless === true;
  const transparentBackground = conversionOptions.transparentBackground === true;
  const colorTolerance =
    conversionOptions.colorTolerance === undefined || conversionOptions.colorTolerance === null
      ? 32
      : sanitizeColorTolerance(conversionOptions.colorTolerance);
  const backgroundDetectionMode =
    conversionOptions.backgroundDetectionMode === undefined ||
    conversionOptions.backgroundDetectionMode === null
      ? 'auto'
      : String(conversionOptions.backgroundDetectionMode).toLowerCase();
  const pickerPointX =
    conversionOptions.pickerPointX === undefined || conversionOptions.pickerPointX === null
      ? null
      : sanitizeUnitInterval(conversionOptions.pickerPointX);
  const pickerPointY =
    conversionOptions.pickerPointY === undefined || conversionOptions.pickerPointY === null
      ? null
      : sanitizeUnitInterval(conversionOptions.pickerPointY);
  const pickerPointsRaw = conversionOptions.pickerPoints;
  let pickerPoints = [];

  if (quality === null && Object.hasOwn(conversionOptions, 'quality')) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'conversionOptions.quality must be an integer between 1 and 100',
      {
        details: [{ field: 'conversionOptions.quality', issue: 'Value out of allowed range' }],
      },
    );
  }

  if (effort === null && Object.hasOwn(conversionOptions, 'effort')) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'conversionOptions.effort must be an integer between 0 and 9',
      {
        details: [{ field: 'conversionOptions.effort', issue: 'Value out of allowed range' }],
      },
    );
  }

  if (colorTolerance === null) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'conversionOptions.colorTolerance must be an integer between 0 and 255',
      {
        details: [
          { field: 'conversionOptions.colorTolerance', issue: 'Value out of allowed range' },
        ],
      },
    );
  }

  if (!ALLOWED_BACKGROUND_DETECTION_MODES.has(backgroundDetectionMode)) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'conversionOptions.backgroundDetectionMode must be one of auto, picker',
      {
        details: [
          {
            field: 'conversionOptions.backgroundDetectionMode',
            issue: 'Unsupported background detection mode',
          },
        ],
      },
    );
  }

  if ((pickerPointX === null) !== (pickerPointY === null)) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'conversionOptions.pickerPointX and pickerPointY must both be provided',
      {
        details: [
          { field: 'conversionOptions', issue: 'Picker coordinates must be provided as a pair' },
        ],
      },
    );
  }

  if (pickerPointX === null && Object.hasOwn(conversionOptions, 'pickerPointX')) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'conversionOptions.pickerPointX must be a number between 0 and 1',
      {
        details: [{ field: 'conversionOptions.pickerPointX', issue: 'Value out of allowed range' }],
      },
    );
  }

  if (pickerPointY === null && Object.hasOwn(conversionOptions, 'pickerPointY')) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'conversionOptions.pickerPointY must be a number between 0 and 1',
      {
        details: [{ field: 'conversionOptions.pickerPointY', issue: 'Value out of allowed range' }],
      },
    );
  }

  if (pickerPointsRaw !== undefined) {
    if (!Array.isArray(pickerPointsRaw)) {
      throw new ApiError(
        400,
        'INVALID_CONVERSION_OPTIONS',
        'conversionOptions.pickerPoints must be an array of points',
        {
          details: [{ field: 'conversionOptions.pickerPoints', issue: 'Expected an array value' }],
        },
      );
    }

    pickerPoints = pickerPointsRaw.map((point) => sanitizePickerPoint(point));

    if (pickerPoints.some((point) => point === null)) {
      throw new ApiError(
        400,
        'INVALID_CONVERSION_OPTIONS',
        'Each picker point must include x/y numbers between 0 and 1',
        {
          details: [
            {
              field: 'conversionOptions.pickerPoints',
              issue: 'Invalid point shape or coordinate value',
            },
          ],
        },
      );
    }
  }

  if (transparentBackground && !ALPHA_CAPABLE_FORMATS.has(normalizedTargetFormat)) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'transparentBackground requires targetFormat to support alpha channel',
      {
        details: [
          {
            field: 'conversionOptions.transparentBackground',
            issue: 'Use png, webp, avif, tiff, or gif as targetFormat',
          },
        ],
      },
    );
  }

  if (transparentBackground && backgroundDetectionMode === 'picker' && pickerPointX === null) {
    if (pickerPoints.length === 0) {
      throw new ApiError(
        400,
        'INVALID_CONVERSION_OPTIONS',
        'picker mode requires at least one picker point',
        {
          details: [
            {
              field: 'conversionOptions',
              issue: 'Choose one or more background points in the preview before converting',
            },
          ],
        },
      );
    }
  }

  if (pickerPointX !== null && pickerPointY !== null) {
    pickerPoints.push({ x: pickerPointX, y: pickerPointY });
  }

  if (pickerPoints.length > 30) {
    throw new ApiError(
      400,
      'INVALID_CONVERSION_OPTIONS',
      'conversionOptions.pickerPoints supports up to 30 points',
      {
        details: [
          {
            field: 'conversionOptions.pickerPoints',
            issue: 'Too many points supplied',
          },
        ],
      },
    );
  }

  return {
    targetFormat: normalizedTargetFormat,
    quality,
    effort,
    lossless,
    transparentBackground,
    colorTolerance,
    backgroundDetectionMode,
    pickerPoints,
  };
}

function toSharpConversionFormatOptions(targetFormat, options) {
  if (targetFormat === 'jpeg') {
    return { quality: options.quality ?? 80, mozjpeg: true };
  }

  if (targetFormat === 'png') {
    const quality = options.quality ?? 80;
    const compressionLevel = Math.min(9, Math.max(0, Math.floor((100 - quality) / 10)));
    return { compressionLevel, palette: true };
  }

  if (targetFormat === 'webp') {
    return {
      quality: options.quality ?? 80,
      effort: Math.min(6, Math.max(0, options.effort ?? 4)),
      lossless: options.lossless,
    };
  }

  if (targetFormat === 'avif') {
    return {
      quality: options.quality ?? 70,
      effort: Math.min(9, Math.max(0, options.effort ?? 5)),
    };
  }

  if (targetFormat === 'tiff') {
    return {
      quality: options.quality ?? 80,
      compression: options.lossless ? 'lzw' : 'jpeg',
    };
  }

  return {
    effort: Math.min(10, Math.max(1, (options.effort ?? 5) + 1)),
  };
}

async function applyTransparentBackground(buffer, options) {
  const prepared = sharp(buffer).rotate().ensureAlpha();
  const { data, info } = await prepared.raw().toBuffer({ resolveWithObject: true });
  const tolerance = options.colorTolerance;

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  const visited = new Uint8Array(width * height);
  const queue = [];

  const enqueue = (x, y, referenceOffset) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) {
      return;
    }

    queue.push({ x, y, referenceOffset });
  };

  if (options.backgroundDetectionMode === 'picker' && Array.isArray(options.pickerPoints)) {
    options.pickerPoints.forEach((point) => {
      const seedX = Math.min(width - 1, Math.max(0, Math.floor(point.x * (width - 1))));
      const seedY = Math.min(height - 1, Math.max(0, Math.floor(point.y * (height - 1))));
      enqueue(seedX, seedY, (seedY * width + seedX) * channels);
    });
  } else {
    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0, x * channels);
      enqueue(x, height - 1, ((height - 1) * width + x) * channels);
    }

    for (let y = 1; y < height - 1; y += 1) {
      enqueue(0, y, y * width * channels);
      enqueue(width - 1, y, (y * width + (width - 1)) * channels);
    }
  }

  for (let pointer = 0; pointer < queue.length; pointer += 1) {
    const { x, y, referenceOffset } = queue[pointer];
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) {
      continue;
    }

    const offset = pixelIndex * channels;
    const alpha = data[offset + 3];
    if (alpha === 0) {
      visited[pixelIndex] = 1;
      continue;
    }

    const matchesTolerance =
      Math.abs(data[offset] - data[referenceOffset]) <= tolerance &&
      Math.abs(data[offset + 1] - data[referenceOffset + 1]) <= tolerance &&
      Math.abs(data[offset + 2] - data[referenceOffset + 2]) <= tolerance;

    if (!matchesTolerance) {
      continue;
    }

    visited[pixelIndex] = 1;
    data[offset + 3] = 0;

    enqueue(x - 1, y, referenceOffset);
    enqueue(x + 1, y, referenceOffset);
    enqueue(x, y - 1, referenceOffset);
    enqueue(x, y + 1, referenceOffset);
    enqueue(x - 1, y - 1, referenceOffset);
    enqueue(x + 1, y + 1, referenceOffset);
    enqueue(x - 1, y + 1, referenceOffset);
    enqueue(x + 1, y - 1, referenceOffset);
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  });
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

async function convertSingleImage(file, options) {
  if (!file?.buffer || file.size === 0) {
    throw new ApiError(400, 'EMPTY_FILE', `Image "${file?.originalname || 'unknown'}" is empty`, {
      details: [{ field: 'files', issue: `Image "${file?.originalname || 'unknown'}" is empty` }],
    });
  }

  try {
    const pipeline = options.transparentBackground
      ? await applyTransparentBackground(file.buffer, options)
      : sharp(file.buffer).rotate();

    const converted = await pipeline
      .toFormat(
        options.targetFormat,
        toSharpConversionFormatOptions(options.targetFormat, {
          quality: options.quality,
          effort: options.effort,
          lossless: options.lossless,
        }),
      )
      .toBuffer();

    return {
      fileName: `${baseName(file.originalname)}-converted.${extensionFromFormat(options.targetFormat)}`,
      buffer: converted,
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

export async function convertImageBuffers(
  files,
  { targetFormat, conversionOptions = null } = {},
  onProgress,
) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ApiError(400, 'INVALID_INPUT', 'Upload at least one image file in field "files"', {
      details: [{ field: 'files', issue: 'At least one image file is required' }],
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 5,
    step: 'Validating conversion options',
    metadata: { totalFiles: files.length, targetFormat },
  });

  const options = normalizeConversionOptions(targetFormat, conversionOptions);

  if (options.transparentBackground && files.length !== 1) {
    throw new ApiError(
      400,
      'TRANSPARENT_BACKGROUND_SINGLE_FILE_ONLY',
      'transparent background conversion supports only one file per request',
      {
        details: [
          {
            field: 'files',
            issue: 'Upload exactly one image when transparentBackground is enabled',
          },
        ],
      },
    );
  }

  const convertedEntries = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const converted = await convertSingleImage(file, options);
    convertedEntries.push(converted);

    const ratio = (index + 1) / files.length;
    safeProgressUpdate(onProgress, {
      progress: Math.min(85, Math.round(12 + ratio * 72)),
      step: `Converted image ${index + 1} of ${files.length}`,
      metadata: {
        currentFileIndex: index + 1,
        totalFiles: files.length,
        currentFileName: file.originalname,
        targetFormat: options.targetFormat,
      },
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 90,
    step: 'Creating conversion archive',
    metadata: { targetFormat: options.targetFormat },
  });

  const zipBuffer = await createZipFromEntries(convertedEntries, onProgress);

  if (!zipBuffer?.length) {
    throw new ApiError(
      500,
      'IMAGE_CONVERSION_FAILED',
      'Failed to generate converted image archive',
    );
  }

  safeProgressUpdate(onProgress, {
    progress: 100,
    step: 'Converted archive generated',
    metadata: { targetFormat: options.targetFormat },
  });

  return zipBuffer;
}

export async function convertSingleImageBuffer(
  file,
  { targetFormat, conversionOptions = null } = {},
  onProgress,
) {
  if (!file || typeof file !== 'object') {
    throw new ApiError(400, 'INVALID_INPUT', 'Upload one image file in field "files"', {
      details: [{ field: 'files', issue: 'A single image file is required' }],
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 8,
    step: 'Validating preview conversion options',
    metadata: { targetFormat },
  });

  const options = normalizeConversionOptions(targetFormat, conversionOptions);
  const converted = await convertSingleImage(file, options);

  safeProgressUpdate(onProgress, {
    progress: 100,
    step: 'Preview image generated',
    metadata: { targetFormat: options.targetFormat },
  });

  return {
    ...converted,
    targetFormat: options.targetFormat,
    mimeType: mimeTypeFromFormat(options.targetFormat),
  };
}
