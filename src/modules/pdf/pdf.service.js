/**
 * Why this exists: merge behavior now supports explicit client merge plans
 * plus per-step progress callbacks for real-time frontend tracking.
 */
import { degrees, PDFDocument } from 'pdf-lib';
import { ApiError } from '../../common/utils/api-error.js';

const ALLOWED_ROTATIONS = new Set([0, 90, 180, 270]);

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
