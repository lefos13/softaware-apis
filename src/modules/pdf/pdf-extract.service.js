/**
 * Why this exists: hybrid extraction combines native PDF text parsing with OCR
 * fallback so scanned/image pages are included in Word exports.
 */
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } from 'docx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import { ApiError } from '../../common/utils/api-error.js';
import { inspectPdfExtractRuntimeDependencies } from './pdf-extract.runtime.js';

const execFileAsync = promisify(execFile);

const ALLOWED_OCR_MODES = new Set(['hybrid']);
const ALLOWED_LANGUAGES = new Set(['eng', 'ell']);
const ALLOWED_PROCESSING_PROFILES = new Set(['fast', 'quality', 'maximum', 'ultra']);

const DEFAULT_EXTRACT_OPTIONS = {
  ocrMode: 'hybrid',
  languages: ['eng', 'ell'],
  processingProfile: 'ultra',
  includePageBreaks: true,
  includeConfidenceMarkers: false,
  minNativeCharsPerPageByProfile: {
    fast: 24,
    quality: 48,
    maximum: 72,
    ultra: 96,
  },
};

const safeProgressUpdate = (onProgress, payload) => {
  if (typeof onProgress !== 'function') {
    return;
  }

  try {
    onProgress(payload);
  } catch {
    // Progress callbacks are best-effort and should never interrupt extraction.
  }
};

const normalizeWhitespace = (value) => {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const normalizeNativeTextContent = (textContent) => {
  if (!textContent?.items || !Array.isArray(textContent.items)) {
    return '';
  }

  const chunks = [];

  for (const item of textContent.items) {
    const token = typeof item?.str === 'string' ? item.str.trim() : '';

    if (token) {
      chunks.push(token);
    }

    if (item?.hasEOL === true) {
      chunks.push('\n');
    }
  }

  return normalizeWhitespace(chunks.join(' '));
};

const normalizeLanguages = (rawLanguages) => {
  if (rawLanguages === undefined) {
    return [...DEFAULT_EXTRACT_OPTIONS.languages];
  }

  if (!Array.isArray(rawLanguages) || rawLanguages.length === 0) {
    throw new ApiError(400, 'INVALID_EXTRACT_OPTIONS', 'languages must be a non-empty array', {
      details: [{ field: 'extractOptions.languages', issue: 'Provide at least one OCR language' }],
    });
  }

  const normalized = rawLanguages.map((language, index) => {
    const code = String(language || '')
      .trim()
      .toLowerCase();

    if (!ALLOWED_LANGUAGES.has(code)) {
      throw new ApiError(
        400,
        'INVALID_EXTRACT_OPTIONS',
        `Unsupported OCR language: ${String(language || '')}`,
        {
          details: [
            {
              field: `extractOptions.languages[${index}]`,
              issue: 'Allowed values are eng and ell',
            },
          ],
        },
      );
    }

    return code;
  });

  return [...new Set(normalized)];
};

const normalizeExtractOptions = (extractOptions) => {
  if (!extractOptions || typeof extractOptions !== 'object' || Array.isArray(extractOptions)) {
    throw new ApiError(400, 'INVALID_EXTRACT_OPTIONS', 'extractOptions must be a JSON object', {
      details: [{ field: 'extractOptions', issue: 'Expected a JSON object payload' }],
    });
  }

  const ocrMode = String(extractOptions.ocrMode || DEFAULT_EXTRACT_OPTIONS.ocrMode).toLowerCase();
  if (!ALLOWED_OCR_MODES.has(ocrMode)) {
    throw new ApiError(400, 'INVALID_EXTRACT_OPTIONS', 'ocrMode must be "hybrid" in v1', {
      details: [{ field: 'extractOptions.ocrMode', issue: 'Only hybrid mode is supported' }],
    });
  }

  const includePageBreaks =
    extractOptions.includePageBreaks === undefined
      ? DEFAULT_EXTRACT_OPTIONS.includePageBreaks
      : Boolean(extractOptions.includePageBreaks);

  const includeConfidenceMarkers =
    extractOptions.includeConfidenceMarkers === undefined
      ? DEFAULT_EXTRACT_OPTIONS.includeConfidenceMarkers
      : Boolean(extractOptions.includeConfidenceMarkers);

  const processingProfile = String(
    extractOptions.processingProfile || DEFAULT_EXTRACT_OPTIONS.processingProfile,
  ).toLowerCase();
  if (!ALLOWED_PROCESSING_PROFILES.has(processingProfile)) {
    throw new ApiError(
      400,
      'INVALID_EXTRACT_OPTIONS',
      'processingProfile must be "fast", "quality", "maximum", or "ultra"',
      {
        details: [
          {
            field: 'extractOptions.processingProfile',
            issue: 'Allowed values are fast, quality, maximum, and ultra',
          },
        ],
      },
    );
  }

  const defaultMinNativeCharsPerPage =
    DEFAULT_EXTRACT_OPTIONS.minNativeCharsPerPageByProfile[processingProfile];
  const minNativeCharsRaw = extractOptions.minNativeCharsPerPage ?? defaultMinNativeCharsPerPage;
  const minNativeCharsPerPage = Number.parseInt(minNativeCharsRaw, 10);

  if (
    !Number.isInteger(minNativeCharsPerPage) ||
    minNativeCharsPerPage < 0 ||
    minNativeCharsPerPage > 5000
  ) {
    throw new ApiError(
      400,
      'INVALID_EXTRACT_OPTIONS',
      'minNativeCharsPerPage must be an integer between 0 and 5000',
      {
        details: [
          {
            field: 'extractOptions.minNativeCharsPerPage',
            issue: 'Value must be an integer between 0 and 5000',
          },
        ],
      },
    );
  }

  return {
    ocrMode,
    languages: normalizeLanguages(extractOptions.languages),
    processingProfile,
    includePageBreaks,
    includeConfidenceMarkers,
    minNativeCharsPerPage,
  };
};

const assertRuntimeDependencies = () => {
  const runtime = inspectPdfExtractRuntimeDependencies();

  if (runtime.available) {
    return;
  }

  throw new ApiError(
    500,
    'OCR_RUNTIME_MISSING',
    'OCR runtime dependencies are missing. Install tesseract and poppler (pdftoppm).',
    {
      details: runtime.missing.map((dependency) => ({
        field: dependency.command,
        issue: `${dependency.displayName} binary is not available in PATH`,
      })),
    },
  );
};

const runCommand = async (command, args, failureCode, failureMessage) => {
  try {
    await execFileAsync(command, args, {
      maxBuffer: 1024 * 1024 * 20,
    });
  } catch (error) {
    const stderr = String(error?.stderr || '').trim();
    const detail = stderr ? `: ${stderr.slice(0, 300)}` : '';

    throw new ApiError(422, failureCode, `${failureMessage}${detail}`);
  }
};

const resolveOcrRasterDpi = (processingProfile) => {
  if (processingProfile === 'ultra') {
    return 700;
  }

  if (processingProfile === 'maximum') {
    return 600;
  }

  if (processingProfile === 'quality') {
    return 450;
  }

  return 300;
};

const renderPdfPageToPng = async ({ pdfPath, pageNumber, tempDirectory, processingProfile }) => {
  const outputPrefix = join(tempDirectory, `page-${pageNumber}`);
  const rasterDpi = resolveOcrRasterDpi(processingProfile);

  await runCommand(
    'pdftoppm',
    [
      '-f',
      String(pageNumber),
      '-l',
      String(pageNumber),
      '-singlefile',
      '-r',
      String(rasterDpi),
      '-png',
      pdfPath,
      outputPrefix,
    ],
    'OCR_FAILED',
    `Failed to rasterize page ${pageNumber} for OCR`,
  );

  const outputImagePath = `${outputPrefix}.png`;

  try {
    await access(outputImagePath, fsConstants.R_OK);
  } catch {
    throw new ApiError(
      422,
      'OCR_FAILED',
      `Rasterized page image is missing for page ${pageNumber}`,
    );
  }

  return outputImagePath;
};

const resolveNeedsExtraOcrPasses = (processingProfile, score) => {
  if (processingProfile === 'fast') {
    return false;
  }

  if (processingProfile === 'quality') {
    return score < 140;
  }

  if (processingProfile === 'maximum') {
    return score < 180;
  }

  return score < 240;
};

const scoreOcrCandidate = (text) => {
  const normalized = normalizeWhitespace(text);
  const compactLength = normalized.replace(/\s/g, '').length;
  const alphaNumericLength = (normalized.match(/[A-Za-z\u0370-\u03FF0-9]/g) || []).length;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const usefulRatio = compactLength > 0 ? alphaNumericLength / compactLength : 0;
  const penalty = usefulRatio < 0.45 ? 40 : 0;

  return compactLength + wordCount * 3 - penalty;
};

const parseTsvConfidence = (rawTsv) => {
  const lines = String(rawTsv || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return null;
  }

  let total = 0;
  let count = 0;

  for (let index = 1; index < lines.length; index += 1) {
    const columns = lines[index].split('\t');
    const confValue = Number.parseFloat(columns[10]);

    if (Number.isFinite(confValue) && confValue >= 0) {
      total += confValue;
      count += 1;
    }
  }

  if (count === 0) {
    return null;
  }

  return total / count;
};

const runOcrPass = async ({
  imagePath,
  pageNumber,
  languageCodes,
  tempDirectory,
  passLabel,
  psm,
  extraArgs = [],
}) => {
  const outputBase = join(tempDirectory, `ocr-page-${pageNumber}-${passLabel}`);

  await runCommand(
    'tesseract',
    [
      imagePath,
      outputBase,
      '-l',
      languageCodes.join('+'),
      '--psm',
      String(psm),
      '--oem',
      '1',
      ...extraArgs,
    ],
    'OCR_FAILED',
    `OCR failed for page ${pageNumber}`,
  );

  const outputTextPath = `${outputBase}.txt`;

  try {
    const raw = await readFile(outputTextPath, 'utf8');
    const text = normalizeWhitespace(raw);
    let confidence = null;

    try {
      const tsvProbe = await execFileAsync(
        'tesseract',
        [
          imagePath,
          'stdout',
          '-l',
          languageCodes.join('+'),
          '--psm',
          String(psm),
          '--oem',
          '1',
          ...extraArgs,
          'tsv',
        ],
        {
          maxBuffer: 1024 * 1024 * 20,
        },
      );

      confidence = parseTsvConfidence(tsvProbe.stdout);
    } catch {
      // Confidence probe is best-effort and must not block OCR output usage.
    }

    return { text, confidence };
  } catch {
    throw new ApiError(422, 'OCR_FAILED', `OCR text output is missing for page ${pageNumber}`);
  }
};

const createOcrVariants = async ({
  rawImagePath,
  pageNumber,
  tempDirectory,
  processingProfile,
}) => {
  const variants = [{ label: 'raw', path: rawImagePath }];

  const normalizedPath = join(tempDirectory, `page-${pageNumber}-normalized.png`);
  await sharp(rawImagePath).grayscale().normalise().toFile(normalizedPath);
  variants.push({ label: 'normalized', path: normalizedPath });

  if (processingProfile === 'maximum' || processingProfile === 'ultra') {
    const thresholdPath = join(tempDirectory, `page-${pageNumber}-threshold.png`);
    await sharp(rawImagePath).grayscale().normalise().threshold(165).toFile(thresholdPath);
    variants.push({ label: 'threshold', path: thresholdPath });
  }

  if (processingProfile === 'ultra') {
    const sharpenedPath = join(tempDirectory, `page-${pageNumber}-sharpened.png`);
    await sharp(rawImagePath).grayscale().normalise().median(1).sharpen().toFile(sharpenedPath);
    variants.push({ label: 'sharpened', path: sharpenedPath });
  }

  return variants;
};

const runOcrOnImage = async ({
  imagePath,
  pageNumber,
  languageCodes,
  tempDirectory,
  processingProfile,
}) => {
  const variants = await createOcrVariants({
    rawImagePath: imagePath,
    pageNumber,
    tempDirectory,
    processingProfile,
  });

  const evaluateCandidate = (candidate) => {
    const qualityScore = scoreOcrCandidate(candidate.text);
    const confidenceBoost = candidate.confidence ? Math.round(candidate.confidence * 1.5) : 0;

    return {
      ...candidate,
      score: qualityScore + confidenceBoost,
    };
  };

  const baseCandidates = [];

  for (const variant of variants.slice(0, Math.min(2, variants.length))) {
    const pageLayoutCandidate = await runOcrPass({
      imagePath: variant.path,
      pageNumber,
      languageCodes,
      tempDirectory,
      passLabel: `${variant.label}-psm3`,
      psm: 3,
    });
    baseCandidates.push(evaluateCandidate(pageLayoutCandidate));

    if (processingProfile !== 'fast') {
      const uniformBlockCandidate = await runOcrPass({
        imagePath: variant.path,
        pageNumber,
        languageCodes,
        tempDirectory,
        passLabel: `${variant.label}-psm6`,
        psm: 6,
        extraArgs: ['-c', 'preserve_interword_spaces=1'],
      });
      baseCandidates.push(evaluateCandidate(uniformBlockCandidate));
    }
  }

  let bestCandidate = baseCandidates.sort((left, right) => right.score - left.score)[0];

  if (!bestCandidate) {
    return '';
  }

  if (!resolveNeedsExtraOcrPasses(processingProfile, bestCandidate.score)) {
    return bestCandidate.text;
  }

  const intensiveCandidates = [];

  for (const variant of variants) {
    const sparseCandidate = await runOcrPass({
      imagePath: variant.path,
      pageNumber,
      languageCodes,
      tempDirectory,
      passLabel: `${variant.label}-psm11`,
      psm: 11,
    });
    intensiveCandidates.push(evaluateCandidate(sparseCandidate));

    if (processingProfile === 'ultra') {
      const singleColumnCandidate = await runOcrPass({
        imagePath: variant.path,
        pageNumber,
        languageCodes,
        tempDirectory,
        passLabel: `${variant.label}-psm4`,
        psm: 4,
      });
      intensiveCandidates.push(evaluateCandidate(singleColumnCandidate));
    }
  }

  const strongerCandidate = intensiveCandidates.sort((left, right) => right.score - left.score)[0];
  if (strongerCandidate && strongerCandidate.score > bestCandidate.score) {
    bestCandidate = strongerCandidate;
  }

  return bestCandidate.text;
};

const combineNativeAndOcrText = ({ nativeText, ocrText }) => {
  if (!nativeText && !ocrText) {
    return '';
  }

  if (!nativeText) {
    return ocrText;
  }

  if (!ocrText) {
    return nativeText;
  }

  if (ocrText.includes(nativeText)) {
    return ocrText;
  }

  if (nativeText.includes(ocrText)) {
    return nativeText;
  }

  return normalizeWhitespace(`${nativeText}\n\n${ocrText}`);
};

const createPageParagraphs = (text, fallbackText) => {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return [
      new Paragraph({
        children: [new TextRun(fallbackText)],
      }),
    ];
  }

  const blocks = normalized
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return [
      new Paragraph({
        children: [new TextRun(fallbackText)],
      }),
    ];
  }

  return blocks.map(
    (block) =>
      new Paragraph({
        children: [new TextRun(block)],
      }),
  );
};

const createDocxBufferFromPages = async ({
  sourceFileName,
  pages,
  includePageBreaks,
  includeConfidenceMarkers,
}) => {
  const createdAt = new Date().toISOString();
  const children = [
    new Paragraph({
      text: 'PDF Text Extraction',
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      text: `Source File: ${sourceFileName}`,
    }),
    new Paragraph({
      text: `Generated At: ${createdAt}`,
    }),
  ];

  pages.forEach((page, index) => {
    if (index > 0 && includePageBreaks) {
      children.push(
        new Paragraph({
          children: [new PageBreak()],
        }),
      );
    }

    children.push(
      new Paragraph({
        text: `Page ${page.pageNumber}`,
        heading: HeadingLevel.HEADING_2,
      }),
    );

    if (includeConfidenceMarkers && page.usedOcrFallback) {
      children.push(
        new Paragraph({
          children: [new TextRun('[OCR fallback applied on this page]')],
        }),
      );
    }

    children.push(...createPageParagraphs(page.text, 'No readable text found on this page.'));
  });

  try {
    const document = new Document({
      sections: [
        {
          children,
        },
      ],
    });

    return await Packer.toBuffer(document);
  } catch {
    throw new ApiError(422, 'DOCX_GENERATION_FAILED', 'Failed to generate Word document output');
  }
};

export const extractPdfToDocxBuffer = async (file, extractOptions = {}, onProgress) => {
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

  assertRuntimeDependencies();

  const options = normalizeExtractOptions(extractOptions);

  safeProgressUpdate(onProgress, {
    progress: 15,
    step: 'Loading source PDF',
    metadata: {
      sourceFileName: file.originalname,
      ocrMode: options.ocrMode,
      languages: options.languages,
      processingProfile: options.processingProfile,
    },
  });

  const tempDirectory = await mkdtemp(join(tmpdir(), 'softaware-pdf-extract-'));
  const pdfPath = join(
    tempDirectory,
    basename(file.originalname || 'source.pdf').replace(/\s+/g, '-'),
  );

  let pdfDocument;

  try {
    await writeFile(pdfPath, file.buffer);

    try {
      const loadingTask = getDocument({
        data: new Uint8Array(file.buffer),
        disableWorker: true,
        useSystemFonts: true,
      });
      pdfDocument = await loadingTask.promise;
    } catch {
      throw new ApiError(
        422,
        'PDF_PARSE_FAILED',
        `File "${file.originalname}" could not be parsed as PDF`,
        {
          details: [{ field: 'files', issue: `File "${file.originalname}" is not a readable PDF` }],
        },
      );
    }

    const totalPages = pdfDocument.numPages;

    if (!Number.isInteger(totalPages) || totalPages < 1) {
      throw new ApiError(422, 'PDF_PARSE_FAILED', 'Uploaded PDF has no readable pages');
    }

    safeProgressUpdate(onProgress, {
      progress: 20,
      step: 'Extracting page text',
      metadata: { totalPages },
    });

    const pages = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const nativeText = normalizeNativeTextContent(textContent);
      const nativeCharCount = nativeText.replace(/\s/g, '').length;
      const shouldRunOcr = nativeCharCount < options.minNativeCharsPerPage;

      let ocrText = '';
      if (shouldRunOcr) {
        const pageImagePath = await renderPdfPageToPng({
          pdfPath,
          pageNumber,
          tempDirectory,
          processingProfile: options.processingProfile,
        });

        ocrText = await runOcrOnImage({
          imagePath: pageImagePath,
          pageNumber,
          languageCodes: options.languages,
          tempDirectory,
          processingProfile: options.processingProfile,
        });
      }

      const mergedText = combineNativeAndOcrText({ nativeText, ocrText });

      pages.push({
        pageNumber,
        text: mergedText,
        usedOcrFallback: shouldRunOcr,
      });

      const ratio = pageNumber / totalPages;
      safeProgressUpdate(onProgress, {
        progress: Math.min(85, Math.round(20 + ratio * 65)),
        step: `Extracted text from page ${pageNumber} of ${totalPages}`,
        metadata: {
          totalPages,
          currentPage: pageNumber,
          usedOcrFallback: shouldRunOcr,
          processingProfile: options.processingProfile,
        },
      });
    }

    safeProgressUpdate(onProgress, {
      progress: 90,
      step: 'Generating Word document',
      metadata: { totalPages: pages.length },
    });

    const docxBuffer = await createDocxBufferFromPages({
      sourceFileName: file.originalname,
      pages,
      includePageBreaks: options.includePageBreaks,
      includeConfidenceMarkers: options.includeConfidenceMarkers,
    });

    safeProgressUpdate(onProgress, {
      progress: 100,
      step: 'Word document generated',
      metadata: {
        totalPages: pages.length,
        pagesWithOcrFallback: pages.filter((page) => page.usedOcrFallback).length,
      },
    });

    return docxBuffer;
  } finally {
    if (pdfDocument && typeof pdfDocument.destroy === 'function') {
      await pdfDocument.destroy();
    }

    await rm(tempDirectory, { recursive: true, force: true });
  }
};
