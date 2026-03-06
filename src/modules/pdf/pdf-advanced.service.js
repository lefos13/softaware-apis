/*
 * Advanced PDF transformations are grouped here so watermarking, numbering,
 * page editing, text extraction, and image-to-PDF share one validation and
 * binary generation layer with consistent progress semantics.
 */
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { ApiError } from '../../common/utils/api-error.js';

const ALLOWED_POSITIONS = new Set([
  'center',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'top-center',
  'bottom-center',
]);
const ALLOWED_MODES = new Set(['page_numbers', 'bates']);
const ALLOWED_ROTATIONS = new Set([0, 90, 180, 270]);

const safeProgressUpdate = (onProgress, payload) => {
  if (typeof onProgress !== 'function') {
    return;
  }

  try {
    onProgress(payload);
  } catch {
    // Progress callbacks are best-effort and should never interrupt processing.
  }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toPositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const toFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizePageRefs = (value, fieldName, totalPages) => {
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_EDIT_PLAN', `${fieldName} must be an array of page numbers`, {
      details: [{ field: fieldName, issue: 'Expected an array of 1-based page numbers' }],
    });
  }

  const out = [];
  const seen = new Set();

  value.forEach((raw, index) => {
    const page = toPositiveInt(raw);
    if (page === null || page > totalPages) {
      throw new ApiError(400, 'INVALID_EDIT_PLAN', `${fieldName} contains invalid page value`, {
        details: [
          {
            field: `${fieldName}[${index}]`,
            issue: `Page must be integer between 1 and ${totalPages}`,
          },
        ],
      });
    }

    if (!seen.has(page)) {
      seen.add(page);
      out.push(page);
    }
  });

  return out;
};

const parseHexColor = (value, fallback = '#9ca3af') => {
  const raw = String(value || fallback)
    .trim()
    .toLowerCase();
  const normalized = raw.startsWith('#') ? raw.slice(1) : raw;

  if (!/^[0-9a-f]{6}$/.test(normalized)) {
    return rgb(0.6117, 0.6392, 0.6862);
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;

  return rgb(red, green, blue);
};

const resolvePosition = ({
  pageWidth,
  pageHeight,
  contentWidth,
  contentHeight,
  position,
  margin,
}) => {
  const safePosition = ALLOWED_POSITIONS.has(position) ? position : 'center';
  const safeMargin = Math.max(0, margin);

  if (safePosition === 'top-left') {
    return { x: safeMargin, y: pageHeight - contentHeight - safeMargin };
  }
  if (safePosition === 'top-right') {
    return { x: pageWidth - contentWidth - safeMargin, y: pageHeight - contentHeight - safeMargin };
  }
  if (safePosition === 'bottom-left') {
    return { x: safeMargin, y: safeMargin };
  }
  if (safePosition === 'bottom-right') {
    return { x: pageWidth - contentWidth - safeMargin, y: safeMargin };
  }
  if (safePosition === 'top-center') {
    return { x: (pageWidth - contentWidth) / 2, y: pageHeight - contentHeight - safeMargin };
  }
  if (safePosition === 'bottom-center') {
    return { x: (pageWidth - contentWidth) / 2, y: safeMargin };
  }

  return { x: (pageWidth - contentWidth) / 2, y: (pageHeight - contentHeight) / 2 };
};

const normalizeText = (textContent) => {
  if (!Array.isArray(textContent?.items)) {
    return '';
  }

  const parts = [];
  for (const item of textContent.items) {
    const token = typeof item?.str === 'string' ? item.str.trim() : '';
    if (token) {
      parts.push(token);
    }

    if (item?.hasEOL === true) {
      parts.push('\n');
    }
  }

  return parts
    .join(' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const createZipFromTextEntries = async (entries, onProgress) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const passThrough = new PassThrough();

    passThrough.on('data', (chunk) => chunks.push(chunk));
    passThrough.on('end', () => resolve(Buffer.concat(chunks)));
    passThrough.on('error', () =>
      reject(new ApiError(500, 'ZIP_ARCHIVE_FAILED', 'Failed to create text ZIP')),
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('progress', (event) => {
      const processed = event?.entries?.processed || 0;
      const total = event?.entries?.total || entries.length;
      const ratio = total > 0 ? processed / total : 0;

      safeProgressUpdate(onProgress, {
        progress: Math.min(98, Math.round(90 + ratio * 8)),
        step: 'Packaging extracted page text files',
        metadata: { processed, total },
      });
    });
    archive.on('error', () =>
      reject(new ApiError(500, 'ZIP_ARCHIVE_FAILED', 'Failed to create text ZIP')),
    );

    archive.pipe(passThrough);
    entries.forEach((entry) => {
      archive.append(entry.content, { name: entry.name });
    });

    archive.finalize().catch(() => {
      reject(new ApiError(500, 'ZIP_ARCHIVE_FAILED', 'Failed to create text ZIP'));
    });
  });
};

export async function addPdfWatermark(
  { file, watermarkOptions = {}, watermarkImageFile },
  onProgress,
) {
  if (!file?.buffer?.length) {
    throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one PDF file in field "files"', {
      details: [{ field: 'files', issue: 'A single PDF file is required' }],
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 8,
    step: 'Loading source PDF',
  });

  let source;
  try {
    source = await PDFDocument.load(file.buffer, { ignoreEncryption: false });
  } catch {
    throw new ApiError(
      422,
      'INVALID_PDF_CONTENT',
      `File "${file.originalname}" is not a valid PDF`,
    );
  }

  const mode = String(watermarkOptions.mode || 'text').toLowerCase();
  const opacity = clamp(toFloat(watermarkOptions.opacity, 0.24), 0.05, 1);
  const margin = clamp(toInt(watermarkOptions.margin, 24), 0, 120);
  const position = String(watermarkOptions.position || 'center').toLowerCase();
  const diagonal = watermarkOptions.diagonal !== false;
  const rotationAngle = toInt(watermarkOptions.rotation, diagonal ? 45 : 0);
  const color = parseHexColor(watermarkOptions.color, '#9ca3af');

  const pageCount = source.getPageCount();
  const pages = source.getPages();
  let imageEmbed = null;
  let font = null;

  if (mode === 'image') {
    if (!watermarkImageFile?.buffer?.length) {
      throw new ApiError(
        400,
        'INVALID_WATERMARK_OPTIONS',
        'watermarkImage file is required for image mode',
        {
          details: [{ field: 'watermarkImage', issue: 'Upload one watermark image file' }],
        },
      );
    }

    const asPngBuffer = await sharp(watermarkImageFile.buffer).png().toBuffer();
    imageEmbed = await source.embedPng(asPngBuffer);
  } else {
    font = await source.embedFont(StandardFonts.HelveticaBold);
  }

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const width = page.getWidth();
    const height = page.getHeight();

    if (mode === 'image') {
      const widthPercent = clamp(toFloat(watermarkOptions.widthPercent, 0.28), 0.05, 0.9);
      const targetWidth = width * widthPercent;
      const scale = targetWidth / imageEmbed.width;
      const targetHeight = imageEmbed.height * scale;
      const coords = resolvePosition({
        pageWidth: width,
        pageHeight: height,
        contentWidth: targetWidth,
        contentHeight: targetHeight,
        position,
        margin,
      });

      page.drawImage(imageEmbed, {
        x: coords.x,
        y: coords.y,
        width: targetWidth,
        height: targetHeight,
        opacity,
        rotate: degrees(rotationAngle),
      });
    } else {
      const watermarkText =
        String(watermarkOptions.text || 'CONFIDENTIAL').trim() || 'CONFIDENTIAL';
      const fontSize = clamp(toInt(watermarkOptions.fontSize, 42), 10, 160);
      const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
      const textHeight = fontSize;

      const coords = resolvePosition({
        pageWidth: width,
        pageHeight: height,
        contentWidth: textWidth,
        contentHeight: textHeight,
        position,
        margin,
      });

      page.drawText(watermarkText, {
        x: coords.x,
        y: coords.y,
        size: fontSize,
        font,
        color,
        opacity,
        rotate: degrees(rotationAngle),
      });
    }

    const ratio = (index + 1) / pageCount;
    safeProgressUpdate(onProgress, {
      progress: Math.min(92, Math.round(16 + ratio * 72)),
      step: `Applying watermark on page ${index + 1} of ${pageCount}`,
      metadata: { page: index + 1, totalPages: pageCount },
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 96,
    step: 'Finalizing watermarked PDF',
  });

  return source.save();
}

export async function addPdfPageNumbers({ file, pageNumberOptions = {} }, onProgress) {
  if (!file?.buffer?.length) {
    throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one PDF file in field "files"', {
      details: [{ field: 'files', issue: 'A single PDF file is required' }],
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 8,
    step: 'Loading source PDF',
  });

  let source;
  try {
    source = await PDFDocument.load(file.buffer, { ignoreEncryption: false });
  } catch {
    throw new ApiError(
      422,
      'INVALID_PDF_CONTENT',
      `File "${file.originalname}" is not a valid PDF`,
    );
  }

  const mode = String(pageNumberOptions.mode || 'page_numbers').toLowerCase();
  if (!ALLOWED_MODES.has(mode)) {
    throw new ApiError(400, 'INVALID_PAGE_NUMBER_OPTIONS', 'mode must be page_numbers or bates', {
      details: [{ field: 'pageNumberOptions.mode', issue: 'Use page_numbers or bates' }],
    });
  }

  const format = String(pageNumberOptions.format || 'Page {page} of {total}');
  const prefix = String(pageNumberOptions.prefix || '');
  const suffix = String(pageNumberOptions.suffix || '');
  const startNumber = clamp(toInt(pageNumberOptions.startNumber, 1), 1, 999999999);
  const padding = clamp(toInt(pageNumberOptions.padding, 6), 1, 16);
  const fontSize = clamp(toInt(pageNumberOptions.fontSize, 11), 8, 72);
  const margin = clamp(toInt(pageNumberOptions.margin, 22), 0, 120);
  const position = String(pageNumberOptions.position || 'bottom-right').toLowerCase();
  const color = parseHexColor(pageNumberOptions.color, '#475569');
  const opacity = clamp(toFloat(pageNumberOptions.opacity, 1), 0.05, 1);

  const font = await source.embedFont(StandardFonts.Helvetica);
  const totalPages = source.getPageCount();
  const pages = source.getPages();

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const pageNumber = index + 1;
    const label =
      mode === 'bates'
        ? `${prefix}${String(startNumber + index).padStart(padding, '0')}${suffix}`
        : format
            .replaceAll('{page}', String(pageNumber))
            .replaceAll('{total}', String(totalPages))
            .replaceAll('{index}', String(index));

    const textWidth = font.widthOfTextAtSize(label, fontSize);
    const textHeight = fontSize;
    const coords = resolvePosition({
      pageWidth: page.getWidth(),
      pageHeight: page.getHeight(),
      contentWidth: textWidth,
      contentHeight: textHeight,
      position,
      margin,
    });

    page.drawText(label, {
      x: coords.x,
      y: coords.y,
      size: fontSize,
      font,
      color,
      opacity,
    });

    const ratio = (index + 1) / totalPages;
    safeProgressUpdate(onProgress, {
      progress: Math.min(92, Math.round(14 + ratio * 76)),
      step: `Numbering page ${index + 1} of ${totalPages}`,
      metadata: { page: index + 1, totalPages, mode },
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 96,
    step: 'Finalizing numbered PDF',
  });

  return source.save();
}

export async function editPdfPages({ file, editPlan = {} }, onProgress) {
  if (!file?.buffer?.length) {
    throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one PDF file in field "files"', {
      details: [{ field: 'files', issue: 'A single PDF file is required' }],
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 8,
    step: 'Loading source PDF',
  });

  let source;
  try {
    source = await PDFDocument.load(file.buffer, { ignoreEncryption: false });
  } catch {
    throw new ApiError(
      422,
      'INVALID_PDF_CONTENT',
      `File "${file.originalname}" is not a valid PDF`,
    );
  }

  const totalPages = source.getPageCount();
  const keep = Array.isArray(editPlan.keep)
    ? normalizePageRefs(editPlan.keep, 'editPlan.keep', totalPages)
    : null;
  const remove = Array.isArray(editPlan.delete)
    ? normalizePageRefs(editPlan.delete, 'editPlan.delete', totalPages)
    : [];
  const reorder = Array.isArray(editPlan.reorder)
    ? normalizePageRefs(editPlan.reorder, 'editPlan.reorder', totalPages)
    : [];
  const rotate = Array.isArray(editPlan.rotate) ? editPlan.rotate : [];

  let selected = keep || Array.from({ length: totalPages }, (_, idx) => idx + 1);
  const removeSet = new Set(remove);
  selected = selected.filter((page) => !removeSet.has(page));

  if (selected.length === 0) {
    throw new ApiError(400, 'INVALID_EDIT_PLAN', 'Edit plan removes all pages', {
      details: [{ field: 'editPlan', issue: 'At least one page must remain in output PDF' }],
    });
  }

  const selectedSet = new Set(selected);
  const ordered = [];
  const seen = new Set();
  reorder.forEach((page, index) => {
    if (!selectedSet.has(page)) {
      throw new ApiError(
        400,
        'INVALID_EDIT_PLAN',
        'reorder contains page not present after keep/delete',
        {
          details: [
            {
              field: `editPlan.reorder[${index}]`,
              issue: 'Page must exist in selected output set',
            },
          ],
        },
      );
    }

    if (!seen.has(page)) {
      seen.add(page);
      ordered.push(page);
    }
  });

  selected.forEach((page) => {
    if (!seen.has(page)) {
      ordered.push(page);
    }
  });

  const rotationByPage = new Map();
  rotate.forEach((entry, index) => {
    const page = toPositiveInt(entry?.page);
    const angle = toInt(entry?.angle, NaN);
    if (page === null || page > totalPages) {
      throw new ApiError(400, 'INVALID_EDIT_PLAN', 'rotate entry has invalid page', {
        details: [
          {
            field: `editPlan.rotate[${index}].page`,
            issue: `Page must be between 1 and ${totalPages}`,
          },
        ],
      });
    }

    if (!ALLOWED_ROTATIONS.has(angle)) {
      throw new ApiError(400, 'INVALID_EDIT_PLAN', 'rotate angle must be one of 0, 90, 180, 270', {
        details: [
          { field: `editPlan.rotate[${index}].angle`, issue: 'Use one of 0, 90, 180, 270' },
        ],
      });
    }

    rotationByPage.set(page, angle);
  });

  const outDoc = await PDFDocument.create();
  for (let index = 0; index < ordered.length; index += 1) {
    const originalPageNumber = ordered[index];
    const [copied] = await outDoc.copyPages(source, [originalPageNumber - 1]);
    const angle = rotationByPage.get(originalPageNumber);
    if (ALLOWED_ROTATIONS.has(angle) && angle !== 0) {
      const current = copied.getRotation().angle;
      copied.setRotation(degrees((current + angle) % 360));
    }

    outDoc.addPage(copied);

    const ratio = (index + 1) / ordered.length;
    safeProgressUpdate(onProgress, {
      progress: Math.min(92, Math.round(14 + ratio * 76)),
      step: `Building edited PDF page ${index + 1} of ${ordered.length}`,
      metadata: { page: index + 1, totalPages: ordered.length },
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 96,
    step: 'Finalizing edited PDF',
  });

  return outDoc.save();
}

export async function extractPdfTextAsTxt({ file, textExtractOptions = {} }, onProgress) {
  if (!file?.buffer?.length) {
    throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one PDF file in field "files"', {
      details: [{ field: 'files', issue: 'A single PDF file is required' }],
    });
  }

  const perPageZip = textExtractOptions.perPageZip === true;
  const includePageHeaders = textExtractOptions.includePageHeaders !== false;

  safeProgressUpdate(onProgress, {
    progress: 8,
    step: 'Parsing PDF text content',
  });

  let doc;
  try {
    doc = await getDocument({ data: file.buffer, disableWorker: true }).promise;
  } catch {
    throw new ApiError(
      422,
      'INVALID_PDF_CONTENT',
      `File "${file.originalname}" is not a valid PDF`,
    );
  }

  const totalPages = doc.numPages;
  const extracted = [];

  for (let index = 1; index <= totalPages; index += 1) {
    const page = await doc.getPage(index);
    const textContent = await page.getTextContent();
    const pageText = normalizeText(textContent);
    extracted.push(pageText);

    const ratio = index / totalPages;
    safeProgressUpdate(onProgress, {
      progress: Math.min(88, Math.round(18 + ratio * 68)),
      step: `Extracting text from page ${index} of ${totalPages}`,
      metadata: { page: index, totalPages },
    });
  }

  if (perPageZip) {
    const entries = extracted.map((text, index) => ({
      name: `page-${String(index + 1).padStart(3, '0')}.txt`,
      content: text || '',
    }));

    safeProgressUpdate(onProgress, {
      progress: 90,
      step: 'Packaging extracted text files',
    });

    const zipBuffer = await createZipFromTextEntries(entries, onProgress);
    return {
      outputType: 'zip',
      fileName: `pdf-text-pages-${Date.now()}.zip`,
      contentType: 'application/zip',
      buffer: zipBuffer,
    };
  }

  const mergedText = extracted
    .map((pageText, index) => {
      if (!includePageHeaders) {
        return pageText;
      }

      return `----- Page ${index + 1} -----\n${pageText || ''}`;
    })
    .join('\n\n')
    .trim();

  safeProgressUpdate(onProgress, {
    progress: 96,
    step: 'Finalizing extracted text',
  });

  return {
    outputType: 'txt',
    fileName: `pdf-text-${Date.now()}.txt`,
    contentType: 'text/plain; charset=utf-8',
    buffer: Buffer.from(mergedText || '', 'utf8'),
  };
}

export async function buildPdfFromImages(files, onProgress) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ApiError(400, 'INVALID_INPUT', 'Upload at least one image file in field "files"', {
      details: [{ field: 'files', issue: 'At least one image file is required' }],
    });
  }

  const outDoc = await PDFDocument.create();

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file?.buffer?.length) {
      throw new ApiError(400, 'EMPTY_FILE', `File "${file?.originalname || 'unknown'}" is empty`);
    }

    let normalizedPng;
    try {
      normalizedPng = await sharp(file.buffer).rotate().png().toBuffer();
    } catch {
      throw new ApiError(
        422,
        'INVALID_IMAGE_CONTENT',
        `File "${file.originalname}" is not a readable image`,
      );
    }

    const metadata = await sharp(normalizedPng).metadata();
    const width = Math.max(1, toInt(metadata.width, 1200));
    const height = Math.max(1, toInt(metadata.height, 1600));

    const embedded = await outDoc.embedPng(normalizedPng);
    const page = outDoc.addPage([width, height]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width,
      height,
    });

    const ratio = (index + 1) / files.length;
    safeProgressUpdate(onProgress, {
      progress: Math.min(92, Math.round(12 + ratio * 78)),
      step: `Embedding image ${index + 1} of ${files.length}`,
      metadata: { page: index + 1, totalPages: files.length, sourceFileName: file.originalname },
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 96,
    step: 'Finalizing PDF generated from images',
  });

  return outDoc.save();
}
