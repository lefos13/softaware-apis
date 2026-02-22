/**
 * Why this exists: API schema now documents automated health checks plus PDF
 * and image-processing contracts so frontend flows remain aligned to backend.
 */
import { env } from '../config/env.js';

const maxFileSizeMb = Math.floor(env.maxFileSizeBytes / (1024 * 1024));
const maxTotalUploadMb = Math.floor(env.maxTotalUploadBytes / (1024 * 1024));

export function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'softaware-apis',
      version: '1.0.0',
      description: 'API contract for file-processing endpoints.',
    },
    servers: [{ url: env.publicBaseUrl }],
    tags: [
      { name: 'Health', description: 'Service liveliness checks.' },
      { name: 'PDF', description: 'PDF processing endpoints.' },
      { name: 'Image', description: 'Image compression endpoints.' },
      { name: 'Tasks', description: 'Long-running task progress endpoints.' },
      { name: 'Admin', description: 'Administrative reporting endpoints.' },
    ],
    paths: {
      '/api/health': {
        get: {
          tags: ['Health'],
          summary: 'Check service health',
          description:
            'Frontend should poll this endpoint automatically and block write actions while unavailable.',
          operationId: 'getHealth',
          responses: {
            200: {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthSuccessResponse' },
                },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/pdf/merge': {
        post: {
          tags: ['PDF'],
          summary: 'Merge multiple PDF files',
          description: `Upload at least 2 PDF files in \`files\` plus optional \`mergePlan\` JSON for explicit order and rotation. Limits: ${env.maxUploadFiles} files, ${maxFileSizeMb} MB each, ${maxTotalUploadMb} MB total.`,
          operationId: 'mergePdf',
          parameters: [
            {
              name: 'taskId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description:
                'Optional client-provided task id used for progress polling. If omitted, backend generates one.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    files: {
                      type: 'array',
                      items: { type: 'string', format: 'binary' },
                      minItems: 2,
                    },
                    mergePlan: {
                      type: 'string',
                      description:
                        'JSON string array. Example: [{"sourceIndex":1,"rotation":90},{"sourceIndex":0,"rotation":0}]',
                    },
                  },
                  required: ['files'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Merged PDF file',
              headers: {
                'X-Operation-Message': {
                  description: 'User-friendly success message for UI notifications',
                  schema: { type: 'string', example: 'PDF files merged successfully' },
                },
                'X-Request-Id': {
                  description: 'Request correlation id for support/debugging',
                  schema: { type: 'string', example: '2d5e4c95-cf21-4b2d-8710-8a77a66cc2d8' },
                },
                'X-Task-Id': {
                  description:
                    'Resolved task id (from query/header/generated) that can be used to poll `/api/tasks/{taskId}` progress',
                  schema: { type: 'string', example: '8c9e7afb-573e-4d34-b6ef-8f0d03f518d6' },
                },
              },
              content: {
                'application/pdf': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            400: {
              description: 'Input validation error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            413: {
              description: 'Upload exceeds per-file or total-size constraints',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            422: {
              description: 'Uploaded file content is not a valid PDF',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/image/compress': {
        post: {
          tags: ['Image'],
          summary: 'Compress one or more images',
          description: `Upload images in \`files\`, choose a mode (light/balanced/aggressive/advanced), and receive a ZIP file with compressed results. Limits: ${env.maxUploadFiles} files, ${maxFileSizeMb} MB each, ${maxTotalUploadMb} MB total.`,
          operationId: 'compressImages',
          parameters: [
            {
              name: 'taskId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description:
                'Optional client-provided task id used for progress polling. If omitted, backend generates one.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    files: {
                      type: 'array',
                      items: { type: 'string', format: 'binary' },
                      minItems: 1,
                    },
                    mode: {
                      type: 'string',
                      enum: ['light', 'balanced', 'aggressive', 'advanced'],
                      default: 'balanced',
                    },
                    advancedOptions: {
                      type: 'string',
                      description:
                        'Required when mode=advanced. JSON string. Example: {"quality":72,"format":"webp","maxWidth":1920,"maxHeight":1920,"effort":5,"lossless":false}',
                    },
                  },
                  required: ['files'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'ZIP archive containing compressed images',
              headers: {
                'X-Operation-Message': {
                  description: 'User-friendly success message for UI notifications',
                  schema: { type: 'string', example: 'Images compressed successfully' },
                },
                'X-Request-Id': {
                  description: 'Request correlation id for support/debugging',
                  schema: { type: 'string', example: '2d5e4c95-cf21-4b2d-8710-8a77a66cc2d8' },
                },
                'X-Task-Id': {
                  description:
                    'Resolved task id (from query/header/generated) that can be used to poll `/api/tasks/{taskId}` progress',
                  schema: { type: 'string', example: '8c9e7afb-573e-4d34-b6ef-8f0d03f518d6' },
                },
              },
              content: {
                'application/zip': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            400: {
              description: 'Input validation error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            413: {
              description: 'Upload exceeds per-file or total-size constraints',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            422: {
              description: 'Uploaded file content is not a valid image',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/tasks/{taskId}': {
        get: {
          tags: ['Tasks'],
          summary: 'Get task progress by task id',
          description:
            'Returns real backend processing progress for PDF merge/image compression tasks. If task is not found yet, the response returns an initializing payload.',
          operationId: 'getTaskProgress',
          parameters: [
            {
              name: 'taskId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description:
                'Task id returned in `X-Task-Id` header or provided by client query/header.',
            },
          ],
          responses: {
            200: {
              description: 'Task progress payload',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TaskProgressSuccessResponse' },
                },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/admin/reports': {
        get: {
          tags: ['Admin'],
          summary: 'List API failure reports',
          description:
            'Lists most recent request-failure reports generated by backend error logging middleware.',
          operationId: 'listFailureReports',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
              description: 'Maximum number of recent report files to return.',
            },
          ],
          responses: {
            200: {
              description: 'Failure reports list',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AdminReportsListSuccessResponse' },
                },
              },
            },
            400: {
              description: 'Invalid query parameters',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/admin/reports/{fileName}': {
        get: {
          tags: ['Admin'],
          summary: 'Get full API failure report details',
          description: 'Fetches one report JSON payload by file name from logs/failures.',
          operationId: 'getFailureReportByFileName',
          parameters: [
            {
              name: 'fileName',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Report file name (for example: 2026-02-21T18-25-27-318Z-<id>.json).',
            },
          ],
          responses: {
            200: {
              description: 'Failure report details',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AdminReportDetailSuccessResponse' },
                },
              },
            },
            400: {
              description: 'Invalid file name/path',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            404: {
              description: 'Report file not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ResponseMeta: {
          type: 'object',
          properties: {
            requestId: {
              type: 'string',
              example: '2d5e4c95-cf21-4b2d-8710-8a77a66cc2d8',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2026-02-21T19:30:00.000Z',
            },
          },
          required: ['requestId', 'timestamp'],
        },
        ErrorDetail: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              example: 'files',
            },
            issue: {
              type: 'string',
              example: 'At least 2 files are required',
            },
          },
          required: ['field', 'issue'],
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'INVALID_INPUT' },
                message: {
                  type: 'string',
                  example: 'Upload at least 2 files in field "files"',
                },
                details: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ErrorDetail' },
                },
              },
              required: ['code', 'message'],
            },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'error', 'meta'],
        },
        MergePlanEntry: {
          type: 'object',
          properties: {
            sourceIndex: {
              type: 'integer',
              minimum: 0,
              example: 1,
              description: 'Index of the source file in uploaded `files` array.',
            },
            rotation: {
              type: 'integer',
              enum: [0, 90, 180, 270],
              example: 90,
              description: 'Rotation in degrees applied to every page of the source file.',
            },
          },
          required: ['sourceIndex', 'rotation'],
        },
        CompressionAdvancedOptions: {
          type: 'object',
          properties: {
            quality: { type: 'integer', minimum: 1, maximum: 100, example: 72 },
            format: { type: 'string', enum: ['jpeg', 'png', 'webp', 'avif'], example: 'webp' },
            maxWidth: { type: 'integer', minimum: 1, example: 1920 },
            maxHeight: { type: 'integer', minimum: 1, example: 1920 },
            effort: { type: 'integer', minimum: 0, maximum: 9, example: 5 },
            lossless: { type: 'boolean', example: false },
          },
          required: ['quality', 'maxWidth', 'maxHeight', 'effort'],
        },
        TaskProgress: {
          type: 'object',
          properties: {
            taskId: { type: 'string', example: '8c9e7afb-573e-4d34-b6ef-8f0d03f518d6' },
            status: {
              type: 'string',
              enum: ['running', 'completed', 'failed'],
              example: 'running',
            },
            progress: { type: 'integer', minimum: 0, maximum: 100, example: 68 },
            step: { type: 'string', example: 'Compressing image 2 of 5' },
            operation: { type: 'string', example: 'image_compress' },
            metadata: { type: 'object', additionalProperties: true },
            error: {
              nullable: true,
              type: 'object',
              properties: {
                code: { type: 'string', example: 'INVALID_IMAGE_CONTENT' },
                message: { type: 'string', example: 'File "x.png" could not be processed' },
              },
            },
            startedAt: { type: 'string', format: 'date-time' },
            completedAt: { nullable: true, type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['taskId', 'status', 'progress', 'step', 'operation', 'startedAt', 'updatedAt'],
        },
        TaskProgressSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Task progress fetched successfully' },
            data: { $ref: '#/components/schemas/TaskProgress' },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'message', 'data', 'meta'],
        },
        AdminFailureReportListItem: {
          type: 'object',
          properties: {
            fileName: { type: 'string' },
            reportType: { type: 'string', example: 'request-failure' },
            createdAt: { nullable: true, type: 'string', format: 'date-time' },
            requestId: { nullable: true, type: 'string' },
            taskId: { nullable: true, type: 'string' },
            statusCode: { nullable: true, type: 'integer', example: 404 },
            errorCode: { nullable: true, type: 'string', example: 'TASK_NOT_FOUND' },
            message: { nullable: true, type: 'string' },
            method: { nullable: true, type: 'string', example: 'GET' },
            path: { nullable: true, type: 'string', example: '/api/tasks/abc' },
            intentTask: { nullable: true, type: 'string', example: 'task_progress_lookup' },
          },
          required: ['fileName', 'reportType'],
        },
        AdminReportsListPayload: {
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 0, example: 2 },
            reports: {
              type: 'array',
              items: { $ref: '#/components/schemas/AdminFailureReportListItem' },
            },
          },
          required: ['count', 'reports'],
        },
        AdminReportsListSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Failure reports fetched successfully' },
            data: { $ref: '#/components/schemas/AdminReportsListPayload' },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'message', 'data', 'meta'],
        },
        AdminReportDetailPayload: {
          type: 'object',
          properties: {
            fileName: { type: 'string' },
            report: { type: 'object', additionalProperties: true },
          },
          required: ['fileName', 'report'],
        },
        AdminReportDetailSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Failure report fetched successfully' },
            data: { $ref: '#/components/schemas/AdminReportDetailPayload' },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'message', 'data', 'meta'],
        },
        HealthSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Service is healthy' },
            data: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'ok' },
              },
              required: ['status'],
            },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'message', 'data', 'meta'],
        },
      },
    },
  };
}
