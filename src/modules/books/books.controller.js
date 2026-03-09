/*
 * The Books controller keeps DOCX and text editing flows aligned with shared
 * task progress, response metadata, and consistent validation/error payloads.
 */
import { basename } from 'node:path';
import {
  completeTaskProgress,
  failTaskProgress,
  updateTaskProgress,
} from '../../common/services/task-progress-store.js';
import { buildResponseMeta, sendSuccess } from '../../common/utils/api-response.js';
import { ApiError } from '../../common/utils/api-error.js';
import { env } from '../../config/env.js';
import { assertServiceQuota } from '../access/access-usage.service.js';
import {
  applyGreekEditorToDocxBuffer,
  applyGreekEditorToText,
  previewGreekEditorDocxReport,
} from './books.service.js';
import { normalizeBooksEditorOptions } from './books.rules.js';

const parseEditorOptions = (rawEditorOptions) => {
  if (!rawEditorOptions) {
    throw new ApiError(400, 'INVALID_EDITOR_OPTIONS', 'editorOptions is required', {
      details: [{ field: 'editorOptions', issue: 'Provide editor options as a JSON payload' }],
    });
  }

  const parsed =
    typeof rawEditorOptions === 'string' ? JSON.parse(rawEditorOptions) : rawEditorOptions;

  return normalizeBooksEditorOptions(parsed);
};

const repairIncomingFileName = (value) => {
  const text = String(value || '');

  if (!/[ÎÏÃÐÑ]/.test(text)) {
    return text;
  }

  try {
    return Buffer.from(text, 'latin1').toString('utf8');
  } catch {
    return text;
  }
};

const buildBaseName = (value) => {
  const normalizedName = repairIncomingFileName(value || 'manuscript.docx');
  const baseName = String(basename(normalizedName)).replace(/\.docx$/i, '');
  return baseName || 'manuscript';
};

/*
 * Content-Disposition needs both an ASCII fallback and an RFC 5987 filename*
 * value so Greek manuscript names download correctly across browsers/clients.
 */
const buildContentDisposition = (fileName) => {
  const asciiFallback = fileName
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encodedFileName = encodeURIComponent(fileName);

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
};

const resolveBinaryOutput = (originalName, outputKind) => {
  const baseName = buildBaseName(originalName);

  if (outputKind === 'zip') {
    return {
      fileName: `${baseName}-edited-package.zip`,
      contentType: 'application/zip',
      message: 'Greek literature corrections and report prepared successfully',
    };
  }

  return {
    fileName: `${baseName}-edited.docx`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    message: 'Greek literature corrections applied successfully',
  };
};

const ensureFeatureEnabled = () => {
  if (!env.booksGreekEditorEnabled) {
    throw new ApiError(404, 'FEATURE_DISABLED', 'Greek literature editor is currently disabled');
  }
};

const assertBooksWordQuota = (req, wordCount) => {
  if (!req.accessPlan) {
    return;
  }

  assertServiceQuota({
    actorKey: req.accessPlan.actorKey,
    serviceKey: req.accessPlan.serviceKey,
    servicePolicy: req.accessPlan.servicePolicy,
    usageCycleStartedAt: req.accessPlan.usageCycleStartedAt,
    usageResetAt: req.accessPlan.usageResetAt,
    incomingRequests: 1,
    incomingWords: wordCount,
    billingKey: req.accessPlan.billingKey,
  });
};

/*
 * The access handshake returns one small authenticated payload so the browser
 * can restore or reject a persisted editor token before exposing the editor UI.
 */
const buildEditorAccessPayload = (req) => ({
  authEnabled: env.booksEditorTokenAuthEnabled,
  token: req.accessPlan?.token
    ? {
        tokenId: req.accessPlan.token.tokenId,
        alias: req.accessPlan.token.alias,
        serviceFlags: req.accessPlan.token.serviceFlags,
        expiresAt: req.accessPlan.token.expiresAt,
      }
    : null,
});

const parseTextPayload = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Request body must be a JSON object', {
      details: [{ field: 'body', issue: 'Provide inputText and editorOptions in JSON' }],
    });
  }

  return {
    inputText: String(body.inputText || ''),
    editorOptions: parseEditorOptions(body.editorOptions),
  };
};

export async function validateGreekEditorAccessController(req, res, next) {
  try {
    ensureFeatureEnabled();

    sendSuccess(res, req, {
      message: env.booksEditorTokenAuthEnabled
        ? 'Greek editor token validated successfully'
        : 'Greek editor token validation is disabled for this environment',
      data: buildEditorAccessPayload(req),
    });
  } catch (error) {
    next(error);
  }
}

export async function applyGreekEditorController(req, res, next) {
  const taskId = req.taskId;

  try {
    ensureFeatureEnabled();

    const files = req.files;
    if (!files || files.length !== 1) {
      throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one DOCX file in field "files"', {
        details: [{ field: 'files', issue: 'Exactly one DOCX file is required' }],
      });
    }

    updateTaskProgress(taskId, {
      progress: 5,
      step: 'Upload received, validating manuscript',
      metadata: { totalFiles: files.length },
    });

    const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
    if (totalBytes > env.maxTotalUploadBytes) {
      throw new ApiError(413, 'TOTAL_UPLOAD_TOO_LARGE', 'Total upload size exceeds allowed limit', {
        details: [
          {
            field: 'files',
            issue: `Combined file size must be <= ${Math.floor(env.maxTotalUploadBytes / (1024 * 1024))} MB`,
          },
        ],
      });
    }

    let editorOptions;
    try {
      editorOptions = parseEditorOptions(req.body?.editorOptions);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiError(400, 'INVALID_EDITOR_OPTIONS', 'editorOptions must be valid JSON', {
          details: [{ field: 'editorOptions', issue: 'Invalid JSON' }],
        });
      }

      throw error;
    }

    const result = await applyGreekEditorToDocxBuffer(files[0], editorOptions, (progressUpdate) => {
      updateTaskProgress(taskId, progressUpdate);
    });
    assertBooksWordQuota(req, result.processedWordCount);
    req.accessUsage = {
      consumedRequests: 1,
      consumedWords: result.processedWordCount,
      metadata: {
        inputType: 'docx',
        includeReport: editorOptions.includeReport === true,
        changedParagraphs: result.summary?.changedParagraphs || 0,
        totalReplacements: result.summary?.totalReplacements || 0,
      },
    };
    const binaryOutput = resolveBinaryOutput(files[0].originalname, result.outputKind);

    updateTaskProgress(taskId, {
      progress: 99,
      step:
        result.outputKind === 'zip'
          ? 'Finalizing manuscript package'
          : 'Finalizing corrected manuscript',
      metadata: result.summary,
    });

    completeTaskProgress(
      taskId,
      result.outputKind === 'zip'
        ? 'Corrected manuscript package ready for download'
        : 'Corrected manuscript ready for download',
    );

    buildResponseMeta(req, res);
    res.setHeader('Content-Type', binaryOutput.contentType);
    res.setHeader('Content-Disposition', buildContentDisposition(binaryOutput.fileName));
    res.setHeader('Content-Length', result.buffer.length);
    res.setHeader('X-Operation-Message', binaryOutput.message);

    res.status(200).send(Buffer.from(result.buffer));
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'Greek literature editor failed',
    });

    next(error);
  }
}

export async function applyGreekEditorTextController(req, res, next) {
  const taskId = req.taskId;

  try {
    ensureFeatureEnabled();

    updateTaskProgress(taskId, {
      progress: 5,
      step: 'Text request received',
      metadata: {},
    });

    let payload;
    try {
      payload = parseTextPayload(req.body);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiError(400, 'INVALID_INPUT', 'Request body must be valid JSON', {
          details: [{ field: 'body', issue: 'Invalid JSON' }],
        });
      }

      throw error;
    }

    const result = await applyGreekEditorToText(
      payload.inputText,
      payload.editorOptions,
      (progressUpdate) => {
        updateTaskProgress(taskId, progressUpdate);
      },
    );
    assertBooksWordQuota(req, result.processedWordCount);
    req.accessUsage = {
      consumedRequests: 1,
      consumedWords: result.processedWordCount,
      metadata: {
        inputType: 'text',
        includeReport: payload.editorOptions.includeReport === true,
        totalReplacements: result.summary?.totalReplacements || 0,
      },
    };

    updateTaskProgress(taskId, {
      progress: 99,
      step: 'Finalizing corrected text',
      metadata: result.summary,
    });

    completeTaskProgress(taskId, 'Corrected text ready');

    sendSuccess(res, req, {
      message: 'Greek literature text corrections applied successfully',
      data: {
        correctedText: result.correctedText,
        summary: result.summary,
        report: result.report,
        reportText: result.reportText,
      },
    });
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'Greek literature text editor failed',
    });

    next(error);
  }
}

export async function previewGreekEditorReportController(req, res, next) {
  const taskId = req.taskId;

  try {
    ensureFeatureEnabled();

    const files = req.files;
    if (!files || files.length !== 1) {
      throw new ApiError(400, 'INVALID_INPUT', 'Upload exactly one DOCX file in field "files"', {
        details: [{ field: 'files', issue: 'Exactly one DOCX file is required' }],
      });
    }

    updateTaskProgress(taskId, {
      progress: 5,
      step: 'Upload received, preparing report preview',
      metadata: { totalFiles: files.length },
    });

    let editorOptions;
    try {
      editorOptions = parseEditorOptions(req.body?.editorOptions);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiError(400, 'INVALID_EDITOR_OPTIONS', 'editorOptions must be valid JSON', {
          details: [{ field: 'editorOptions', issue: 'Invalid JSON' }],
        });
      }

      throw error;
    }

    const result = await previewGreekEditorDocxReport(files[0], editorOptions, (progressUpdate) => {
      updateTaskProgress(taskId, progressUpdate);
    });
    assertBooksWordQuota(req, result.processedWordCount);
    req.accessUsage = {
      consumedRequests: 1,
      consumedWords: result.processedWordCount,
      metadata: {
        inputType: 'docx',
        includeReport: true,
        previewOnly: true,
        totalReplacements: result.summary?.totalReplacements || 0,
      },
    };

    updateTaskProgress(taskId, {
      progress: 99,
      step: 'Report preview ready',
      metadata: result.summary,
    });

    completeTaskProgress(taskId, 'Report preview ready');

    sendSuccess(res, req, {
      message: 'Greek literature report preview generated successfully',
      data: {
        summary: result.summary,
        report: result.report,
        reportText: result.reportText,
      },
    });
  } catch (error) {
    failTaskProgress(taskId, {
      code: error?.code,
      message: error?.message,
      step: 'Greek literature report preview failed',
    });

    next(error);
  }
}
