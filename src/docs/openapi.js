/**
 * Why this exists: API schema now documents automated health checks plus PDF
 * and image-processing contracts so frontend flows remain aligned to backend.
 * It now includes PDF-to-DOCX extraction (with OCR fallback) and image
 * conversion so tools can offer broader support with shared conventions.
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
      { name: 'Image', description: 'Image compression and format-conversion endpoints.' },
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
            415: {
              description: 'Uploaded file type is not supported',
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
      '/api/pdf/split': {
        post: {
          tags: ['PDF'],
          summary: 'Split a single PDF into multiple PDFs',
          description: `Upload exactly one PDF in \`files\`, select split \`mode\` and \`splitOptions\`, and receive a ZIP archive containing split PDFs. Limits: ${env.maxUploadFiles} files, ${maxFileSizeMb} MB each, ${maxTotalUploadMb} MB total.`,
          operationId: 'splitPdf',
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
                      maxItems: 1,
                    },
                    mode: {
                      type: 'string',
                      enum: ['range', 'selected_pages', 'every_n_pages', 'custom_groups'],
                      description: 'Split strategy to apply to the uploaded PDF.',
                    },
                    splitOptions: {
                      type: 'string',
                      description:
                        'JSON string. Examples: {"fromPage":3,"toPage":12} (range), {"pages":[1,5,10]} (selected_pages), {"chunkSize":4} (every_n_pages), {"groups":[{"name":"intro","ranges":["1-3"],"pages":[8]}]} (custom_groups).',
                    },
                  },
                  required: ['files', 'mode', 'splitOptions'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'ZIP archive containing split PDFs',
              headers: {
                'X-Operation-Message': {
                  description: 'User-friendly success message for UI notifications',
                  schema: { type: 'string', example: 'PDF split completed successfully' },
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
            415: {
              description: 'Uploaded file type is not supported',
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
      '/api/pdf/extract-to-docx': {
        post: {
          tags: ['PDF'],
          summary: 'Extract PDF text to Word (.docx) with OCR fallback for scanned pages',
          description: `Upload exactly one PDF in \`files\` plus required \`extractOptions\` JSON. The API extracts native text and automatically runs OCR for pages with low native text. Use \`processingProfile\` (\`fast\`, \`quality\`, \`maximum\`, \`ultra\`) to control OCR effort. Limits: ${env.maxUploadFiles} files, ${maxFileSizeMb} MB each, ${maxTotalUploadMb} MB total.`,
          operationId: 'extractPdfToDocx',
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
                      maxItems: 1,
                    },
                    extractOptions: {
                      type: 'string',
                      description:
                        'JSON string. Example: {"ocrMode":"hybrid","languages":["eng","ell"],"processingProfile":"ultra","includePageBreaks":true,"includeConfidenceMarkers":false}.',
                    },
                  },
                  required: ['files', 'extractOptions'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Word document containing extracted text',
              headers: {
                'X-Operation-Message': {
                  description: 'User-friendly success message for UI notifications',
                  schema: { type: 'string', example: 'PDF text extracted to Word successfully' },
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
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
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
            415: {
              description: 'Uploaded file type is not supported',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            422: {
              description: 'PDF parsing, OCR, or DOCX generation failed',
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
      '/api/image/convert': {
        post: {
          tags: ['Image'],
          summary: 'Convert one or more images to a target format',
          description: `Upload images in \`files\`, set \`targetFormat\`, and receive a ZIP file with converted results. Automatic/picker-seeded transparent background removal is available for alpha-capable output formats (png/webp/avif/tiff/gif) and requires exactly one image per request. Limits: ${env.maxUploadFiles} files, ${maxFileSizeMb} MB each, ${maxTotalUploadMb} MB total.`,
          operationId: 'convertImages',
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
                    targetFormat: {
                      type: 'string',
                      enum: ['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif'],
                      description: 'Desired output format applied to all uploaded images.',
                    },
                    conversionOptions: {
                      type: 'string',
                      description:
                        'Optional JSON string. Example: {"quality":82,"effort":5,"lossless":false,"transparentBackground":true,"backgroundDetectionMode":"auto","colorTolerance":32} or picker mode {"transparentBackground":true,"backgroundDetectionMode":"picker","pickerPoints":[{"x":0.1,"y":0.2},{"x":0.15,"y":0.25}],"colorTolerance":32}',
                    },
                  },
                  required: ['files', 'targetFormat'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'ZIP archive containing converted images',
              headers: {
                'X-Operation-Message': {
                  description: 'User-friendly success message for UI notifications',
                  schema: { type: 'string', example: 'Images converted successfully' },
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
      '/api/image/convert-preview': {
        post: {
          tags: ['Image'],
          summary: 'Convert one image and return a direct preview file',
          description:
            'Single-image conversion endpoint intended for UX preview flows. Returns one converted image binary instead of ZIP and supports the same conversionOptions as `/api/image/convert`.',
          operationId: 'convertImagePreview',
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
                      maxItems: 1,
                    },
                    targetFormat: {
                      type: 'string',
                      enum: ['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif'],
                    },
                    conversionOptions: {
                      type: 'string',
                      description:
                        'Optional JSON string. Example: {"quality":82,"effort":5,"lossless":false,"transparentBackground":true,"backgroundDetectionMode":"picker","pickerPoints":[{"x":0.1,"y":0.2}],"colorTolerance":32}',
                    },
                  },
                  required: ['files', 'targetFormat'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Converted image preview',
              headers: {
                'X-Operation-Message': {
                  description: 'User-friendly success message for UI notifications',
                  schema: { type: 'string', example: 'Image preview generated successfully' },
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
                'image/*': {
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
            'Returns real backend processing progress for PDF merge/PDF split/PDF extract-to-DOCX/image compression/image conversion/image preview conversion tasks. If task is not found yet, the response returns an initializing payload.',
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
        PdfExtractOptions: {
          type: 'object',
          properties: {
            ocrMode: {
              type: 'string',
              enum: ['hybrid'],
              example: 'hybrid',
            },
            languages: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['eng', 'ell'],
              },
              example: ['eng', 'ell'],
            },
            processingProfile: {
              type: 'string',
              enum: ['fast', 'quality', 'maximum', 'ultra'],
              example: 'ultra',
            },
            includePageBreaks: { type: 'boolean', example: true },
            includeConfidenceMarkers: { type: 'boolean', example: false },
            minNativeCharsPerPage: { type: 'integer', minimum: 0, maximum: 5000, example: 96 },
          },
          required: [
            'ocrMode',
            'languages',
            'processingProfile',
            'includePageBreaks',
            'includeConfidenceMarkers',
          ],
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
