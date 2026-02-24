import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import { Router } from 'express';
import {
  compressImagesController,
  convertImagePreviewController,
  convertImagesController,
} from './image.controller.js';
import { imageUpload } from './image.upload.js';

const imageRouter = Router();

imageRouter.post(
  '/compress',
  initializeTaskProgress('image_compress'),
  imageUpload.array('files'),
  compressImagesController,
);

imageRouter.post(
  '/convert-preview',
  initializeTaskProgress('image_convert_preview'),
  imageUpload.array('files'),
  convertImagePreviewController,
);

imageRouter.post(
  '/convert',
  initializeTaskProgress('image_convert'),
  imageUpload.array('files'),
  convertImagesController,
);

export { imageRouter };
