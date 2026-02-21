/**
 * Why this exists: frontend teams often need a stable OpenAPI JSON artifact
 * for code generation and contract checks outside the running API server.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiSpec } from '../docs/openapi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const projectRoot = resolve(__dirname, '../..');
const outputDir = resolve(projectRoot, 'docs');
const outputFile = resolve(outputDir, 'openapi.json');

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(buildOpenApiSpec(), null, 2)}\n`, 'utf8');

console.log(`[softaware-apis] OpenAPI spec exported to ${outputFile}`);
