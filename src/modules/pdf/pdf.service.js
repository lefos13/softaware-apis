/**
 * Why this exists: merge behavior now supports explicit client merge plans
 * plus per-step progress callbacks for real-time frontend tracking.
 * It now also provides PDF split operations with multiple split strategies
 * while preserving the same validation, progress, and archive output patterns.
 */
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { degrees, PDFDocument } from 'pdf-lib';
import { ApiError } from '../../common/utils/api-error.js';

const ALLOWED_ROTATIONS = new Set([0, 90, 180, 270]);
const ALLOWED_SPLIT_MODES = new Set(['range', 'selected_pages', 'every_n_pages', 'custom_groups']);

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

const sanitizeOutputName = (value, fallback) => {
  const raw = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return raw || fallback;
};

const parseRangeToken = (token) => {
  const cleaned = String(token || '').trim();
  const match = cleaned.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) {
    return null;
  }

  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1 || start > end) {
    return null;
  }

  return { start, end };
};

const ensurePageNumberInBounds = (page, totalPages, field) => {
  if (!Number.isInteger(page) || page < 1 || page > totalPages) {
    throw new ApiError(
      400,
      'INVALID_PAGE_REFERENCE',
      `Page ${page} is outside the PDF page range`,
      {
        details: [{ field, issue: `Page must be between 1 and ${totalPages}` }],
      },
    );
  }
};

const buildRangePages = (fromPage, toPage, totalPages, fieldPrefix) => {
  ensurePageNumberInBounds(fromPage, totalPages, `${fieldPrefix}.fromPage`);
  ensurePageNumberInBounds(toPage, totalPages, `${fieldPrefix}.toPage`);

  if (fromPage > toPage) {
    throw new ApiError(
      400,
      'INVALID_SPLIT_OPTIONS',
      'fromPage must be less than or equal to toPage',
      {
        details: [{ field: `${fieldPrefix}`, issue: 'fromPage cannot be greater than toPage' }],
      },
    );
  }

  const pages = [];
  for (let page = fromPage; page <= toPage; page += 1) {
    pages.push(page);
  }
  return pages;
};

function normalizeSplitPlan(mode, splitOptions, totalPages) {
  if (!ALLOWED_SPLIT_MODES.has(mode)) {
    throw new ApiError(
      400,
      'INVALID_SPLIT_MODE',
      'mode must be one of range, selected_pages, every_n_pages, custom_groups',
      {
        details: [{ field: 'mode', issue: 'Unsupported split mode' }],
      },
    );
  }

  if (!splitOptions || typeof splitOptions !== 'object' || Array.isArray(splitOptions)) {
    throw new ApiError(400, 'INVALID_SPLIT_OPTIONS', 'splitOptions must be a JSON object', {
      details: [{ field: 'splitOptions', issue: 'Expected an object payload' }],
    });
  }

  if (mode === 'range') {
    const fromPage = toPositiveInt(splitOptions.fromPage);
    const toPage = toPositiveInt(splitOptions.toPage);

    if (fromPage === null || toPage === null) {
      throw new ApiError(
        400,
        'INVALID_SPLIT_OPTIONS',
        'range mode requires fromPage/toPage positive integers',
        {
          details: [{ field: 'splitOptions', issue: 'fromPage and toPage are required' }],
        },
      );
    }

    return [
      {
        name: `range-${fromPage}-${toPage}.pdf`,
        pages: buildRangePages(fromPage, toPage, totalPages, 'splitOptions'),
      },
    ];
  }

  if (mode === 'selected_pages') {
    if (!Array.isArray(splitOptions.pages) || splitOptions.pages.length === 0) {
      throw new ApiError(
        400,
        'INVALID_SPLIT_OPTIONS',
        'selected_pages mode requires non-empty pages array',
        {
          details: [{ field: 'splitOptions.pages', issue: 'Provide at least one page' }],
        },
      );
    }

    const deduped = [];
    const seen = new Set();

    splitOptions.pages.forEach((rawPage, index) => {
      const page = toPositiveInt(rawPage);
      if (page === null) {
        throw new ApiError(
          400,
          'INVALID_SPLIT_OPTIONS',
          'selected_pages contains invalid page numbers',
          {
            details: [
              { field: `splitOptions.pages[${index}]`, issue: 'Value must be a positive integer' },
            ],
          },
        );
      }

      ensurePageNumberInBounds(page, totalPages, `splitOptions.pages[${index}]`);

      if (!seen.has(page)) {
        seen.add(page);
        deduped.push(page);
      }
    });

    const nameLabel = deduped.slice(0, 10).join('-');
    const suffix = deduped.length > 10 ? '-plus-more' : '';

    return [{ name: `selected-pages-${nameLabel}${suffix}.pdf`, pages: deduped }];
  }

  if (mode === 'every_n_pages') {
    const chunkSize = toPositiveInt(splitOptions.chunkSize);
    if (chunkSize === null) {
      throw new ApiError(
        400,
        'INVALID_SPLIT_OPTIONS',
        'every_n_pages mode requires chunkSize positive integer',
        {
          details: [{ field: 'splitOptions.chunkSize', issue: 'Value must be a positive integer' }],
        },
      );
    }

    const chunks = [];
    for (let start = 1, index = 1; start <= totalPages; start += chunkSize, index += 1) {
      const end = Math.min(totalPages, start + chunkSize - 1);
      chunks.push({
        name: `chunk-${index}-pages-${start}-${end}.pdf`,
        pages: buildRangePages(start, end, totalPages, 'splitOptions'),
      });
    }

    return chunks;
  }

  if (!Array.isArray(splitOptions.groups) || splitOptions.groups.length === 0) {
    throw new ApiError(
      400,
      'INVALID_SPLIT_OPTIONS',
      'custom_groups mode requires non-empty groups array',
      {
        details: [{ field: 'splitOptions.groups', issue: 'Provide at least one group' }],
      },
    );
  }

  if (splitOptions.groups.length > 100) {
    throw new ApiError(400, 'INVALID_SPLIT_OPTIONS', 'custom_groups supports up to 100 groups', {
      details: [{ field: 'splitOptions.groups', issue: 'Too many groups supplied' }],
    });
  }

  return splitOptions.groups.map((group, index) => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      throw new ApiError(400, 'INVALID_SPLIT_OPTIONS', 'Each group must be an object', {
        details: [{ field: `splitOptions.groups[${index}]`, issue: 'Invalid group shape' }],
      });
    }

    const explicitPages = Array.isArray(group.pages) ? group.pages : [];
    const ranges = Array.isArray(group.ranges) ? group.ranges : [];

    if (explicitPages.length === 0 && ranges.length === 0) {
      throw new ApiError(
        400,
        'INVALID_SPLIT_OPTIONS',
        'Each group must include pages and/or ranges',
        {
          details: [
            {
              field: `splitOptions.groups[${index}]`,
              issue: 'Add at least one page or range',
            },
          ],
        },
      );
    }

    const groupPages = [];
    const seen = new Set();

    explicitPages.forEach((rawPage, pageIndex) => {
      const page = toPositiveInt(rawPage);
      if (page === null) {
        throw new ApiError(400, 'INVALID_SPLIT_OPTIONS', 'Group pages must be positive integers', {
          details: [
            {
              field: `splitOptions.groups[${index}].pages[${pageIndex}]`,
              issue: 'Value must be a positive integer',
            },
          ],
        });
      }

      ensurePageNumberInBounds(
        page,
        totalPages,
        `splitOptions.groups[${index}].pages[${pageIndex}]`,
      );
      if (!seen.has(page)) {
        seen.add(page);
        groupPages.push(page);
      }
    });

    ranges.forEach((token, tokenIndex) => {
      const parsedRange = parseRangeToken(token);
      if (!parsedRange) {
        throw new ApiError(400, 'INVALID_SPLIT_OPTIONS', 'Invalid range token in group', {
          details: [
            {
              field: `splitOptions.groups[${index}].ranges[${tokenIndex}]`,
              issue: 'Use format "start-end", example "3-7"',
            },
          ],
        });
      }

      ensurePageNumberInBounds(
        parsedRange.start,
        totalPages,
        `splitOptions.groups[${index}].ranges[${tokenIndex}]`,
      );
      ensurePageNumberInBounds(
        parsedRange.end,
        totalPages,
        `splitOptions.groups[${index}].ranges[${tokenIndex}]`,
      );

      for (let page = parsedRange.start; page <= parsedRange.end; page += 1) {
        if (!seen.has(page)) {
          seen.add(page);
          groupPages.push(page);
        }
      }
    });

    const safeName = sanitizeOutputName(group.name, `group-${index + 1}`);
    return {
      name: `group-${index + 1}-${safeName}.pdf`,
      pages: groupPages,
    };
  });
}

async function createZipFromEntries(entries, onProgress) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const passThrough = new PassThrough();

    passThrough.on('data', (chunk) => {
      chunks.push(chunk);
    });
    passThrough.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    passThrough.on('error', () => {
      reject(new ApiError(500, 'ZIP_ARCHIVE_FAILED', 'Failed to generate PDF split archive'));
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('progress', (event) => {
      const total = event?.entries?.total || entries.length;
      const processed = event?.entries?.processed || 0;
      const ratio = total > 0 ? processed / total : 0;

      safeProgressUpdate(onProgress, {
        progress: Math.min(98, Math.round(88 + ratio * 10)),
        step: 'Packaging split files',
        metadata: { archivedFiles: processed, totalFiles: total },
      });
    });
    archive.on('error', () => {
      reject(new ApiError(500, 'ZIP_ARCHIVE_FAILED', 'Failed to generate PDF split archive'));
    });

    archive.pipe(passThrough);
    entries.forEach((entry) => {
      archive.append(entry.buffer, { name: entry.fileName });
    });

    archive.finalize().catch(() => {
      reject(new ApiError(500, 'ZIP_ARCHIVE_FAILED', 'Failed to generate PDF split archive'));
    });
  });
}

function normalizeMergePlan(mergePlan, fileCount) {
  if (!Array.isArray(mergePlan) || mergePlan.length === 0) {
    return Array.from({ length: fileCount }, (_, sourceIndex) => ({ sourceIndex, rotation: 0 }));
  }

  if (mergePlan.length !== fileCount) {
    throw new ApiError(
      400,
      'INVALID_MERGE_PLAN',
      'Merge plan must include each uploaded file exactly once',
      {
        details: [
          { field: 'mergePlan', issue: 'mergePlan length must match uploaded files count' },
        ],
      },
    );
  }

  const seenIndexes = new Set();

  const normalized = mergePlan.map((entry, position) => {
    const sourceIndex = Number.parseInt(entry?.sourceIndex, 10);
    const rotation = Number.parseInt(entry?.rotation, 10);

    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= fileCount) {
      throw new ApiError(400, 'INVALID_MERGE_PLAN', 'Merge plan contains an invalid source index', {
        details: [
          {
            field: `mergePlan[${position}].sourceIndex`,
            issue: 'Index must map to an uploaded file',
          },
        ],
      });
    }

    if (seenIndexes.has(sourceIndex)) {
      throw new ApiError(400, 'INVALID_MERGE_PLAN', 'Merge plan cannot repeat source files', {
        details: [
          { field: `mergePlan[${position}].sourceIndex`, issue: 'Duplicate source index detected' },
        ],
      });
    }

    seenIndexes.add(sourceIndex);

    if (!ALLOWED_ROTATIONS.has(rotation)) {
      throw new ApiError(
        400,
        'INVALID_MERGE_PLAN',
        'Merge plan contains an invalid rotation value',
        {
          details: [
            {
              field: `mergePlan[${position}].rotation`,
              issue: 'Rotation must be one of 0, 90, 180, 270',
            },
          ],
        },
      );
    }

    return { sourceIndex, rotation };
  });

  return normalized;
}

export async function mergePdfBuffers(files, mergePlan = [], onProgress) {
  if (!Array.isArray(files) || files.length < 2) {
    throw new ApiError(400, 'INVALID_INPUT', 'At least 2 PDF files are required', {
      details: [{ field: 'files', issue: 'Provide 2 or more PDF files' }],
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 5,
    step: 'Validating merge plan',
    metadata: { totalFiles: files.length },
  });

  const normalizedPlan = normalizeMergePlan(mergePlan, files.length);
  const merged = await PDFDocument.create();

  for (let index = 0; index < normalizedPlan.length; index += 1) {
    const instruction = normalizedPlan[index];
    const file = files[instruction.sourceIndex];

    if (!file?.buffer || file.size === 0) {
      throw new ApiError(400, 'EMPTY_FILE', 'One or more uploaded files are empty', {
        details: [{ field: 'files', issue: `File "${file?.originalname || 'unknown'}" is empty` }],
      });
    }

    try {
      const source = await PDFDocument.load(file.buffer, { ignoreEncryption: false });
      const pages = await merged.copyPages(source, source.getPageIndices());

      pages.forEach((page) => {
        if (instruction.rotation !== 0) {
          const currentAngle = page.getRotation().angle;
          page.setRotation(degrees((currentAngle + instruction.rotation) % 360));
        }

        merged.addPage(page);
      });

      const ratio = (index + 1) / normalizedPlan.length;
      safeProgressUpdate(onProgress, {
        progress: Math.min(90, Math.round(10 + ratio * 78)),
        step: `Merged file ${index + 1} of ${normalizedPlan.length}`,
        metadata: {
          currentFileIndex: index + 1,
          totalFiles: normalizedPlan.length,
          currentFileName: file.originalname,
        },
      });
    } catch {
      throw new ApiError(
        422,
        'INVALID_PDF_CONTENT',
        `File "${file.originalname}" is not a valid PDF`,
        {
          details: [
            { field: 'files', issue: `File "${file.originalname}" could not be parsed as PDF` },
          ],
        },
      );
    }
  }

  safeProgressUpdate(onProgress, {
    progress: 95,
    step: 'Finalizing merged PDF',
  });

  const mergedBytes = await merged.save();

  if (!mergedBytes?.length) {
    throw new ApiError(500, 'PDF_MERGE_FAILED', 'Failed to generate merged PDF');
  }

  safeProgressUpdate(onProgress, {
    progress: 100,
    step: 'Merged PDF generated',
  });

  return mergedBytes;
}

export async function splitPdfBuffer(file, { mode, splitOptions = {} } = {}, onProgress) {
  if (!file || typeof file !== 'object') {
    throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one PDF file in field "files"', {
      details: [{ field: 'files', issue: 'A single PDF file is required' }],
    });
  }

  if (!file.buffer || file.size === 0) {
    throw new ApiError(400, 'EMPTY_FILE', `File "${file.originalname || 'unknown'}" is empty`, {
      details: [{ field: 'files', issue: `File "${file.originalname || 'unknown'}" is empty` }],
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 6,
    step: 'Loading source PDF',
    metadata: { sourceFileName: file.originalname, mode },
  });

  let source;
  try {
    source = await PDFDocument.load(file.buffer, { ignoreEncryption: false });
  } catch {
    throw new ApiError(
      422,
      'INVALID_PDF_CONTENT',
      `File "${file.originalname}" is not a valid PDF`,
      {
        details: [
          { field: 'files', issue: `File "${file.originalname}" could not be parsed as PDF` },
        ],
      },
    );
  }

  const totalPages = source.getPageCount();
  if (totalPages < 1) {
    throw new ApiError(422, 'INVALID_PDF_CONTENT', 'Uploaded PDF has no readable pages');
  }

  safeProgressUpdate(onProgress, {
    progress: 15,
    step: 'Validating split options',
    metadata: { totalPages, mode },
  });

  const plan = normalizeSplitPlan(mode, splitOptions, totalPages);
  const sourcePageIndices = source.getPageIndices();
  const outputs = [];

  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index];
    const outDoc = await PDFDocument.create();

    const pageIndices = item.pages.map((page) => page - 1);
    const copied = await outDoc.copyPages(source, pageIndices);
    copied.forEach((page) => outDoc.addPage(page));

    const bytes = await outDoc.save();
    outputs.push({ fileName: item.name, buffer: Buffer.from(bytes) });

    const ratio = (index + 1) / plan.length;
    safeProgressUpdate(onProgress, {
      progress: Math.min(84, Math.round(20 + ratio * 62)),
      step: `Created split file ${index + 1} of ${plan.length}`,
      metadata: {
        currentOutputIndex: index + 1,
        totalOutputs: plan.length,
        outputFileName: item.name,
        sourcePages: sourcePageIndices.length,
      },
    });
  }

  safeProgressUpdate(onProgress, {
    progress: 88,
    step: 'Creating split archive',
    metadata: { totalOutputs: outputs.length },
  });

  const zipBuffer = await createZipFromEntries(outputs, onProgress);
  if (!zipBuffer?.length) {
    throw new ApiError(500, 'PDF_SPLIT_FAILED', 'Failed to generate split PDF archive');
  }

  safeProgressUpdate(onProgress, {
    progress: 100,
    step: 'Split archive generated',
    metadata: { totalOutputs: outputs.length },
  });

  return zipBuffer;
}
