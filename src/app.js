/**
 * Why this exists: app assembly is split from server startup so tests/workers
 * share the same app, and API contract endpoints are exposed for frontend use.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { apiRouter } from './routes/index.js';
import { env } from './config/env.js';
import { buildOpenApiSpec } from './docs/openapi.js';
import { errorHandler, notFoundHandler } from './common/middleware/error-handler.js';
import { sendSuccess } from './common/utils/api-response.js';

const app = express();
const openApiSpec = buildOpenApiSpec();

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin,
    exposedHeaders: ['Content-Disposition', 'X-Operation-Message', 'X-Request-Id', 'X-Task-Id'],
  }),
);
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  sendSuccess(res, req, {
    message: 'Service metadata fetched successfully',
    data: {
      service: 'softaware-apis',
      version: '1.0.0',
      docs: '/api/docs',
    },
  });
});

app.get('/api/openapi.json', (_req, res) => {
  res.status(200).json(openApiSpec);
});
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.use('/api', apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export { app };
