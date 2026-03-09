import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import { requireTrustedClient } from '../../common/middleware/trusted-client.middleware.js';
import { Router } from 'express';
import { resolveServiceAccessPlan } from '../access/access-plan.middleware.js';
import { ACCESS_TOKEN_SERVICE_FLAGS } from '../admin/admin-token.constants.js';
import {
  compressImagesController,
  convertImagePreviewController,
  convertImagesController,
} from './image.controller.js';
import { imageUpload } from './image.upload.js';

const imageRouter = Router();

imageRouter.use(requireTrustedClient);

imageRouter.post(
  '/compress',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.IMAGE, 'image_compress'),
  initializeTaskProgress('image_compress'),
  imageUpload.array('files'),
  compressImagesController,
);

imageRouter.post(
  '/convert-preview',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.IMAGE, 'image_convert_preview'),
  initializeTaskProgress('image_convert_preview'),
  imageUpload.array('files'),
  convertImagePreviewController,
);

imageRouter.post(
  '/convert',
  resolveServiceAccessPlan(ACCESS_TOKEN_SERVICE_FLAGS.IMAGE, 'image_convert'),
  initializeTaskProgress('image_convert'),
  imageUpload.array('files'),
  convertImagesController,
);

export { imageRouter };
