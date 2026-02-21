# softaware-apis

Starter API platform for everyday file-processing procedures (merge PDFs, convert files, image operations, etc.).

## Why this architecture

- `src/modules/*`: business capabilities grouped by domain (pdf, image, docs).
- `src/config`: environment and runtime settings.
- `src/common`: shared middleware and utilities.
- `src/routes`: central route composition.
- Controllers remain transport-focused; services hold reusable domain logic.

This keeps the project simple now, while making it easy to split heavy tasks into workers later.

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create env file:
   ```bash
   cp .env.example .env
   ```
3. Run dev server:
   ```bash
   npm run dev
   ```

Server default: `http://localhost:3000`

## Code quality workflow (ESLint, Prettier, Husky)

Why this was added: backend/frontend alignment depends on predictable code
quality rules, and commit-time checks reduce integration regressions.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Enable git hooks:
   ```bash
   npm run prepare
   ```
3. Run checks manually when needed:
   ```bash
   npm run lint
   npm run format:check
   ```
4. Fix issues automatically:
   ```bash
   npm run lint:fix
   npm run format
   ```

Pre-commit behavior:

- Husky runs `lint-staged` on every commit.
- Staged `*.js` files are linted (`eslint --fix`) then formatted (`prettier --write`).
- Staged `*.json`, `*.md`, `*.yml`, `*.yaml` files are formatted (`prettier --write`).

## API contract for frontend alignment (Swagger/OpenAPI)

This project now exposes a backend contract that frontend teams can use directly.

1. Interactive Swagger UI:
   - `GET /api/docs`
2. Raw OpenAPI JSON from running backend:
   - `GET /api/openapi.json`
3. Export OpenAPI JSON file to repo (for CI/codegen):
   ```bash
   npm run openapi:export
   ```
   Output file: `docs/openapi.json`

If your backend is not served from `http://localhost:3000`, set:

```bash
PUBLIC_BASE_URL=https://your-api-domain.com
```

in `.env` so generated server URLs match the real environment.

### Frontend integration examples

Generate TypeScript API types:

```bash
npx openapi-typescript http://localhost:3000/api/openapi.json -o src/types/api.ts
```

Generate from exported file:

```bash
npx openapi-typescript ./docs/openapi.json -o src/types/api.ts
```

Recommended workflow:

1. Backend updates endpoints/contracts.
2. Backend runs `npm run openapi:export` and commits updated `docs/openapi.json`.
3. Frontend regenerates types/SDK from that file.
4. Both teams rely on the same contract artifact to avoid drift.

## Current API signatures

### Health

- `GET /api/health`
- Intended for automated polling from frontend guard logic (for example every 5-10 seconds).

### Merge PDFs

- `POST /api/pdf/merge`
- `Content-Type: multipart/form-data`
- File field: `files` (must include at least 2 PDFs)
- Optional field: `mergePlan` (JSON string array) for explicit order + per-file rotation.
- Upload limits (default): max `20` files, max `25 MB` per file, max `120 MB` total request size.

Example:

```bash
curl -X POST http://localhost:3000/api/pdf/merge \
  -F "files=@/absolute/path/first.pdf" \
  -F "files=@/absolute/path/second.pdf" \
  -F 'mergePlan=[{"sourceIndex":1,"rotation":90},{"sourceIndex":0,"rotation":0}]' \
  --output merged.pdf
```

`mergePlan` shape:

```json
[
  { "sourceIndex": 1, "rotation": 90 },
  { "sourceIndex": 0, "rotation": 0 }
]
```

Rules:

- Include each uploaded file exactly once.
- `sourceIndex` points to the index in uploaded `files` array.
- `rotation` must be one of `0`, `90`, `180`, `270`.

### Compress Images

- `POST /api/image/compress`
- `Content-Type: multipart/form-data`
- File field: `files` (must include at least 1 supported image)
- Supported formats: `jpeg`, `png`, `webp`, `avif`
- Upload limits (default): max `20` files, max `25 MB` per file, max `120 MB` total request size.
- `mode` values: `light`, `balanced`, `aggressive`, `advanced`
- Optional `advancedOptions` (JSON string, required only for `mode=advanced`)

Example:

```bash
curl -X POST http://localhost:3000/api/image/compress \
  -F "files=@/absolute/path/photo-1.jpg" \
  -F "files=@/absolute/path/photo-2.png" \
  -F "mode=advanced" \
  -F 'advancedOptions={"quality":72,"format":"webp","maxWidth":1920,"maxHeight":1920,"effort":5,"lossless":false}' \
  --output compressed-images.zip
```

Advanced options shape:

```json
{
  "quality": 72,
  "format": "webp",
  "maxWidth": 1920,
  "maxHeight": 1920,
  "effort": 5,
  "lossless": false
}
```

Rules:

- `quality`: integer from `1` to `100`
- `format`: one of `jpeg`, `png`, `webp`, `avif`
- `maxWidth` and `maxHeight`: positive integers
- `effort`: integer from `0` to `9`
- `lossless`: boolean (primarily useful for `webp`)

## Response contract for frontend messaging

Why this was added: frontend needs consistent message + metadata fields to show
clear user feedback and provide support/debug references.

Success JSON responses follow:

```json
{
  "success": true,
  "message": "Human-readable success message",
  "data": {},
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601 date-time"
  }
}
```

Error JSON responses follow:

```json
{
  "success": false,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable error message",
    "details": [{ "field": "files", "issue": "validation detail" }]
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601 date-time"
  }
}
```

Binary file endpoints (like PDF merge) additionally include headers:

- `X-Operation-Message`: user-friendly success message.
- `X-Request-Id`: request correlation id.

### PDF merge error codes to handle in frontend

- `INVALID_INPUT`: missing/invalid form payload.
- `INVALID_MERGE_PLAN`: mergePlan has invalid JSON/shape/index/rotation values.
- `INVALID_FILE_TYPE`: non-PDF upload.
- `EMPTY_FILE`: empty uploaded file.
- `INVALID_PDF_CONTENT`: file cannot be parsed as valid PDF.
- `FILE_TOO_LARGE`: uploaded file exceeds configured size limit.
- `TOTAL_UPLOAD_TOO_LARGE`: combined upload size exceeds configured total limit.
- `TOO_MANY_FILES`: uploaded file count exceeds configured limit.
- `UNEXPECTED_FILE_FIELD`: multipart field is not `files`.
- `INTERNAL_SERVER_ERROR`: unhandled backend failure.

### Image compression error codes to handle in frontend

- `INVALID_INPUT`: missing/invalid files payload.
- `INVALID_COMPRESSION_MODE`: mode is not one of supported values.
- `INVALID_ADVANCED_OPTIONS`: advanced JSON/options are missing or invalid.
- `INVALID_FILE_TYPE`: upload contains unsupported image type.
- `EMPTY_FILE`: one or more uploaded images are empty.
- `INVALID_IMAGE_CONTENT`: file could not be processed as image.
- `FILE_TOO_LARGE`: uploaded file exceeds configured size limit.
- `TOTAL_UPLOAD_TOO_LARGE`: combined upload size exceeds configured total limit.
- `TOO_MANY_FILES`: uploaded file count exceeds configured limit.
- `UNEXPECTED_FILE_FIELD`: multipart field is not `files`.
- `ZIP_ARCHIVE_FAILED`: server failed to build output ZIP.
- `INTERNAL_SERVER_ERROR`: unhandled backend failure.

## Suggested roadmap for your portal services

- Add modules: `image`, `document`, `archive`, `signature`.
- For CPU-heavy jobs (OCR, large conversions), move work to a queue/worker service.
- Keep the API as an orchestrator with async job status endpoints.

## Is Express the right choice?

Express is a good starting choice for your scope because:

- Massive ecosystem for file and document processing.
- Fast onboarding and maintainability.
- Easy to move to modular services later.

When you scale heavy background processing, a better architecture is:

- API layer: Express (or Fastify).
- Worker layer: Node workers + queue (BullMQ/RabbitMQ/SQS).
- Optional alt stack: Python workers for specialized document/image AI/OCR tasks while keeping Node API gateway.

That hybrid model usually gives the best balance for platforms like yours.
