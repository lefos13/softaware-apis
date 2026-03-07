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
      { name: 'Books', description: 'Book and manuscript editing endpoints.' },
      { name: 'Utils', description: 'Lightweight utility endpoints.' },
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
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
      '/api/pdf/watermark': {
        post: {
          tags: ['PDF'],
          summary: 'Apply text or image watermark to one PDF',
          description:
            'Upload one source PDF in `files` and optional `watermarkImage` when `watermarkOptions.mode="image"`.',
          operationId: 'watermarkPdf',
          parameters: [
            {
              name: 'taskId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
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
                    watermarkImage: { type: 'string', format: 'binary' },
                    watermarkOptions: {
                      type: 'string',
                      description:
                        'Optional JSON string. Example: {"mode":"text","text":"CONFIDENTIAL","position":"center","opacity":0.22,"fontSize":42,"rotation":45} or {"mode":"image","position":"center","opacity":0.28}.',
                    },
                  },
                  required: ['files'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Watermarked PDF binary output',
              content: {
                'application/pdf': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            400: {
              description: 'Input validation error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            413: {
              description: 'Upload exceeds size constraints',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            415: {
              description: 'Unsupported file type',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            422: {
              description: 'Uploaded source file is not valid PDF content',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
          },
        },
      },
      '/api/books/greek-editor/apply': {
        post: {
          tags: ['Books'],
          summary: 'Apply Greek literature editing rules to one Word (.docx) manuscript',
          description: `Upload exactly one DOCX in \`files\` plus required \`editorOptions\` JSON. The service edits only the main body text of \`word/document.xml\`, applies the selected rules in fixed server order, and returns one corrected DOCX. Limits: ${env.maxUploadFiles} files, ${maxFileSizeMb} MB each, ${maxTotalUploadMb} MB total.`,
          operationId: 'applyGreekEditorRules',
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
                    editorOptions: {
                      type: 'string',
                      description:
                        'JSON string. Example: {"ruleIds":["kai_before_vowel","ellipsis_normalize"]}. Allowed values: kai_before_vowel, stin_article_trim, min_negation_trim, sa_to_san, ellipsis_normalize.',
                    },
                  },
                  required: ['files', 'editorOptions'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Corrected DOCX manuscript',
              headers: {
                'X-Operation-Message': {
                  description: 'User-friendly success message for UI notifications',
                  schema: {
                    type: 'string',
                    example: 'Greek literature corrections applied successfully',
                  },
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
              description: 'DOCX parsing or OOXML rewriting failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
      '/api/pdf/page-numbers': {
        post: {
          tags: ['PDF'],
          summary: 'Add page numbers or Bates numbering to one PDF',
          description:
            'Upload one source PDF in `files` and provide optional `pageNumberOptions` JSON for formatting and mode control.',
          operationId: 'addPdfPageNumbers',
          parameters: [
            {
              name: 'taskId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
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
                    pageNumberOptions: {
                      type: 'string',
                      description:
                        'Optional JSON string. Example: {"mode":"page_numbers","format":"Page {page} of {total}","position":"bottom-right","fontSize":11} or Bates mode {"mode":"bates","prefix":"ACME-","startNumber":1,"padding":6}.',
                    },
                  },
                  required: ['files'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Numbered PDF binary output',
              content: {
                'application/pdf': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            400: {
              description: 'Input validation error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            413: {
              description: 'Upload exceeds size constraints',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            415: {
              description: 'Unsupported file type',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            422: {
              description: 'Uploaded source file is not valid PDF content',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
          },
        },
      },
      '/api/pdf/edit-pages': {
        post: {
          tags: ['PDF'],
          summary: 'Edit PDF pages (rotate/reorder/delete/keep)',
          description:
            'Upload one source PDF in `files` and provide required `editPlan` JSON with operations.',
          operationId: 'editPdfPages',
          parameters: [
            {
              name: 'taskId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
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
                    editPlan: {
                      type: 'string',
                      description:
                        'Required JSON string. Example: {"keep":[1,2,3,4],"delete":[2],"reorder":[4,1,3],"rotate":[{"page":4,"angle":90}]}.',
                    },
                  },
                  required: ['files', 'editPlan'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Edited PDF binary output',
              content: {
                'application/pdf': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            400: {
              description: 'Input validation error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            413: {
              description: 'Upload exceeds size constraints',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            415: {
              description: 'Unsupported file type',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            422: {
              description: 'Uploaded source file is not valid PDF content',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
          },
        },
      },
      '/api/pdf/extract-text': {
        post: {
          tags: ['PDF'],
          summary: 'Extract native PDF text to .txt (or ZIP per page)',
          description:
            'Upload one source PDF in `files`. Optional `textExtractOptions.perPageZip=true` returns ZIP with per-page text files.',
          operationId: 'extractPdfText',
          parameters: [
            {
              name: 'taskId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
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
                    textExtractOptions: {
                      type: 'string',
                      description:
                        'Optional JSON string. Example: {"perPageZip":false,"includePageHeaders":true}.',
                    },
                  },
                  required: ['files'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Extracted text output (TXT or ZIP)',
              content: {
                'text/plain': { schema: { type: 'string', format: 'binary' } },
                'application/zip': { schema: { type: 'string', format: 'binary' } },
              },
            },
            400: {
              description: 'Input validation error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            413: {
              description: 'Upload exceeds size constraints',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            415: {
              description: 'Unsupported file type',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            422: {
              description: 'Uploaded source file is not valid PDF content',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
          },
        },
      },
      '/api/pdf/from-images': {
        post: {
          tags: ['PDF'],
          summary: 'Create one PDF from uploaded images',
          description:
            'Upload one or more images in `files`. Each image becomes one page in output PDF, preserving upload order.',
          operationId: 'pdfFromImages',
          parameters: [
            {
              name: 'taskId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
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
                  },
                  required: ['files'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'PDF output generated from images',
              content: {
                'application/pdf': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            400: {
              description: 'Input validation error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            413: {
              description: 'Upload exceeds size constraints',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            415: {
              description: 'Unsupported file type',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            422: {
              description: 'Uploaded source image could not be processed',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
              },
            },
            500: {
              description: 'Unexpected server error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
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
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
      '/api/utils/checksum': {
        post: {
          tags: ['Utils'],
          summary: 'Compute SHA-256 checksum for one file',
          description:
            'Upload one file in field `file` and receive SHA-256 hash plus file size metadata.',
          operationId: 'computeChecksum',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: { type: 'string', format: 'binary' },
                  },
                  required: ['file'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Checksum response',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ChecksumSuccessResponse' },
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
              description: 'Uploaded file exceeds size constraints',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
      '/api/utils/webhook-bin': {
        post: {
          tags: ['Utils'],
          summary: 'Create a temporary webhook request bin',
          description:
            'Creates an in-memory webhook bin and returns an unguessable id plus secret required for subsequent write/read operations.',
          operationId: 'createWebhookBin',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ttlSeconds: {
                      type: 'integer',
                      minimum: 60,
                      maximum: 604800,
                      description: 'Optional custom TTL in seconds (defaults to server setting).',
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Webhook bin created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WebhookBinCreateSuccessResponse' },
                },
              },
            },
            429: {
              description: 'Rate limit exceeded or webhook bin capacity reached',
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
      '/api/utils/webhook-bin/{id}': {
        post: {
          tags: ['Utils'],
          summary: 'Store one webhook request payload in a bin',
          description:
            'Writes one request snapshot to a webhook bin. Requires `x-bin-secret` header from bin creation response.',
          operationId: 'appendWebhookBinRequest',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'x-bin-secret',
              in: 'header',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          responses: {
            200: {
              description: 'Webhook request stored',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WebhookBinStoreSuccessResponse' },
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
            403: {
              description: 'Invalid webhook bin secret',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            404: {
              description: 'Webhook bin not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            410: {
              description: 'Webhook bin expired',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            413: {
              description: 'Payload too large',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
        get: {
          tags: ['Utils'],
          summary: 'Fetch recent webhook requests from a bin',
          description:
            'Reads stored request snapshots from a webhook bin. Requires `x-bin-secret` header.',
          operationId: 'getWebhookBinRequests',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'x-bin-secret',
              in: 'header',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1 },
            },
          ],
          responses: {
            200: {
              description: 'Webhook bin contents',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WebhookBinFetchSuccessResponse' },
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
            403: {
              description: 'Invalid webhook bin secret',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            404: {
              description: 'Webhook bin not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            410: {
              description: 'Webhook bin expired',
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
            'Lists most recent request-failure reports generated by backend error logging middleware. Non-superadmin tokens only receive reports in their owner scope.',
          operationId: 'listFailureReports',
          parameters: [
            {
              name: 'x-admin-token',
              in: 'header',
              required: true,
              schema: { type: 'string' },
              description: 'Admin or superadmin token minted via server-side CLI.',
            },
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
            401: {
              description: 'Missing admin token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            403: {
              description: 'Invalid, expired, or unauthorized admin token',
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
          summary: 'Get full sanitized API failure report details',
          description:
            'Fetches one sanitized report payload by file name from logs/failures, scoped by admin token owner unless token role is superadmin.',
          operationId: 'getFailureReportByFileName',
          parameters: [
            {
              name: 'x-admin-token',
              in: 'header',
              required: true,
              schema: { type: 'string' },
              description: 'Admin or superadmin token minted via server-side CLI.',
            },
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
            401: {
              description: 'Missing admin token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            403: {
              description: 'Invalid token or report outside owner scope',
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
      '/api/admin/tokens': {
        get: {
          tags: ['Admin'],
          summary: 'List admin tokens',
          description:
            'Lists admin and superadmin token metadata for superadmin session management. Plaintext tokens and stored hashes are never returned.',
          operationId: 'listAdminTokens',
          parameters: [
            {
              name: 'x-admin-token',
              in: 'header',
              required: true,
              schema: { type: 'string' },
              description: 'Superadmin token minted via server-side CLI.',
            },
          ],
          responses: {
            200: {
              description: 'Admin token inventory',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AdminTokensListSuccessResponse' },
                },
              },
            },
            401: {
              description: 'Missing admin token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            403: {
              description: 'Invalid token or token role is not superadmin',
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
      '/api/admin/tokens/revoke': {
        post: {
          tags: ['Admin'],
          summary: 'Revoke selected admin tokens',
          description:
            'Revokes one or many admin or superadmin tokens by token id. This endpoint is restricted to superadmin tokens.',
          operationId: 'revokeAdminTokens',
          parameters: [
            {
              name: 'x-admin-token',
              in: 'header',
              required: true,
              schema: { type: 'string' },
              description: 'Superadmin token minted via server-side CLI.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminTokenRevokeRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Selected tokens revoked successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AdminTokenRevokeSuccessResponse' },
                },
              },
            },
            400: {
              description: 'Missing or invalid tokenIds payload',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            401: {
              description: 'Missing admin token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            403: {
              description: 'Invalid token or token role is not superadmin',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            404: {
              description: 'One or more token ids were not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
      '/api/admin/tokens/invalidate-all': {
        post: {
          tags: ['Admin'],
          summary: 'Invalidate all admin tokens',
          description:
            'Revokes all active admin and superadmin tokens immediately. This endpoint is restricted to superadmin tokens.',
          operationId: 'invalidateAllAdminTokens',
          parameters: [
            {
              name: 'x-admin-token',
              in: 'header',
              required: true,
              schema: { type: 'string' },
              description: 'Superadmin token minted via server-side CLI.',
            },
          ],
          responses: {
            200: {
              description: 'Tokens invalidated successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AdminTokenInvalidateAllSuccessResponse' },
                },
              },
            },
            401: {
              description: 'Missing admin token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            403: {
              description: 'Invalid token or token role is not superadmin',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            429: {
              description: 'Mutating request rate limit exceeded for source IP',
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
        ChecksumPayload: {
          type: 'object',
          properties: {
            sha256: {
              type: 'string',
              example: '6f1ed002ab5595859014ebf0951522d9c0f4f99f95f96f2ab6e6f8f8ebf0bfb4',
            },
            sizeBytes: { type: 'integer', minimum: 0, example: 25013 },
            fileName: { nullable: true, type: 'string', example: 'report.pdf' },
          },
          required: ['sha256', 'sizeBytes', 'fileName'],
        },
        ChecksumSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Checksum computed successfully' },
            data: { $ref: '#/components/schemas/ChecksumPayload' },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'message', 'data', 'meta'],
        },
        WebhookBinCreatePayload: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            secret: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' },
            ttlSeconds: { type: 'integer', minimum: 60 },
          },
          required: ['id', 'secret', 'createdAt', 'expiresAt', 'ttlSeconds'],
        },
        WebhookBinCreateSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Webhook bin created successfully' },
            data: { $ref: '#/components/schemas/WebhookBinCreatePayload' },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'message', 'data', 'meta'],
        },
        WebhookBinStorePayload: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            storedEntries: { type: 'integer', minimum: 0 },
            expiresAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'storedEntries', 'expiresAt'],
        },
        WebhookBinStoreSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Webhook request stored successfully' },
            data: { $ref: '#/components/schemas/WebhookBinStorePayload' },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'message', 'data', 'meta'],
        },
        WebhookBinRequestEntry: {
          type: 'object',
          properties: {
            receivedAt: { type: 'string', format: 'date-time' },
            method: { type: 'string', example: 'POST' },
            path: { type: 'string' },
            query: { type: 'object', additionalProperties: true },
            body: { type: 'object', additionalProperties: true },
            headers: { type: 'object', additionalProperties: true },
          },
          required: ['receivedAt', 'method', 'path', 'query', 'body', 'headers'],
        },
        WebhookBinFetchPayload: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' },
            count: { type: 'integer', minimum: 0 },
            requests: {
              type: 'array',
              items: { $ref: '#/components/schemas/WebhookBinRequestEntry' },
            },
          },
          required: ['id', 'createdAt', 'expiresAt', 'count', 'requests'],
        },
        WebhookBinFetchSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Webhook bin fetched successfully' },
            data: { $ref: '#/components/schemas/WebhookBinFetchPayload' },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'message', 'data', 'meta'],
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
            ownerId: { type: 'string', example: 'public' },
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
          required: ['fileName', 'reportType', 'ownerId'],
        },
        AdminSanitizedFailureReport: {
          type: 'object',
          properties: {
            fileName: { type: 'string' },
            reportType: { type: 'string', example: 'request-failure' },
            ownerId: { type: 'string', example: 'public' },
            createdAt: { nullable: true, type: 'string', format: 'date-time' },
            requestId: { nullable: true, type: 'string' },
            taskId: { nullable: true, type: 'string' },
            operation: {
              type: 'object',
              properties: {
                method: { nullable: true, type: 'string', example: 'POST' },
                path: { nullable: true, type: 'string', example: '/api/pdf/merge' },
                intentTask: { nullable: true, type: 'string', example: 'pdf_merge' },
              },
              required: ['method', 'path', 'intentTask'],
            },
            requestContext: {
              type: 'object',
              properties: {
                queryKeys: { type: 'array', items: { type: 'string' } },
                bodyKeys: { type: 'array', items: { type: 'string' } },
                uploadedFileCount: { type: 'integer', minimum: 0, example: 2 },
                uploadedBytes: { type: 'integer', minimum: 0, example: 5251232 },
                mimeTypes: { type: 'array', items: { type: 'string', example: 'application/pdf' } },
              },
              required: [
                'queryKeys',
                'bodyKeys',
                'uploadedFileCount',
                'uploadedBytes',
                'mimeTypes',
              ],
            },
            failure: {
              type: 'object',
              properties: {
                statusCode: { nullable: true, type: 'integer', example: 400 },
                code: { nullable: true, type: 'string', example: 'INVALID_INPUT' },
                message: { nullable: true, type: 'string' },
                details: { type: 'array', items: { $ref: '#/components/schemas/ErrorDetail' } },
                isUnexpectedError: { type: 'boolean', example: false },
              },
              required: ['statusCode', 'code', 'message', 'details', 'isUnexpectedError'],
            },
          },
          required: [
            'fileName',
            'reportType',
            'ownerId',
            'createdAt',
            'requestId',
            'taskId',
            'operation',
            'requestContext',
            'failure',
          ],
        },
        AdminReportsListPayload: {
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 0, example: 2 },
            reports: {
              type: 'array',
              items: { $ref: '#/components/schemas/AdminFailureReportListItem' },
            },
            viewerRole: { type: 'string', enum: ['admin', 'superadmin'], example: 'admin' },
            viewerOwnerId: { type: 'string', example: 'public' },
          },
          required: ['count', 'reports', 'viewerRole', 'viewerOwnerId'],
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
            report: { $ref: '#/components/schemas/AdminSanitizedFailureReport' },
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
        AdminTokenInventoryItem: {
          type: 'object',
          properties: {
            tokenId: { type: 'string', example: 'e41a494b-ca7b-4790-8f30-6fba24ed5685' },
            role: { type: 'string', enum: ['admin', 'superadmin'], example: 'superadmin' },
            ownerId: { type: 'string', example: 'global' },
            createdAt: { nullable: true, type: 'string', format: 'date-time' },
            expiresAt: { nullable: true, type: 'string', format: 'date-time' },
            revokedAt: { nullable: true, type: 'string', format: 'date-time' },
            revocationReason: {
              nullable: true,
              type: 'string',
              example: 'superadmin_revoke_selected',
            },
            revokedByTokenId: { nullable: true, type: 'string' },
            isCurrent: { type: 'boolean', example: true },
            isExpired: { type: 'boolean', example: false },
            isActive: { type: 'boolean', example: true },
          },
          required: [
            'tokenId',
            'role',
            'ownerId',
            'createdAt',
            'expiresAt',
            'revokedAt',
            'revocationReason',
            'revokedByTokenId',
            'isCurrent',
            'isExpired',
            'isActive',
          ],
        },
        AdminTokensListPayload: {
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 0, example: 4 },
            tokens: {
              type: 'array',
              items: { $ref: '#/components/schemas/AdminTokenInventoryItem' },
            },
            currentTokenId: { nullable: true, type: 'string' },
          },
          required: ['count', 'tokens', 'currentTokenId'],
        },
        AdminTokensListSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Admin tokens fetched successfully' },
            data: { $ref: '#/components/schemas/AdminTokensListPayload' },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'message', 'data', 'meta'],
        },
        AdminTokenRevokeRequest: {
          type: 'object',
          properties: {
            tokenIds: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', example: 'e41a494b-ca7b-4790-8f30-6fba24ed5685' },
            },
          },
          required: ['tokenIds'],
        },
        AdminTokenRevokePayload: {
          type: 'object',
          properties: {
            requested: { type: 'integer', minimum: 1, example: 2 },
            revoked: { type: 'integer', minimum: 0, example: 2 },
            revokedAt: { type: 'string', format: 'date-time' },
            revokedTokenIds: { type: 'array', items: { type: 'string' } },
            revokedCurrentToken: { type: 'boolean', example: false },
          },
          required: ['requested', 'revoked', 'revokedAt', 'revokedTokenIds', 'revokedCurrentToken'],
        },
        AdminTokenRevokeSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Selected admin tokens revoked successfully' },
            data: { $ref: '#/components/schemas/AdminTokenRevokePayload' },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
          required: ['success', 'message', 'data', 'meta'],
        },
        AdminTokenInvalidateAllPayload: {
          type: 'object',
          properties: {
            invalidated: { type: 'integer', minimum: 0, example: 3 },
            revokedAt: { type: 'string', format: 'date-time' },
            invalidatedByTokenId: { nullable: true, type: 'string' },
          },
          required: ['invalidated', 'revokedAt', 'invalidatedByTokenId'],
        },
        AdminTokenInvalidateAllSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'All admin tokens invalidated successfully' },
            data: { $ref: '#/components/schemas/AdminTokenInvalidateAllPayload' },
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
