import { initializeTaskProgress } from '../../common/middleware/task-context.js';
import { Router } from 'express';
import { compressImagesController } from './image.controller.js';
import { imageUpload } from './image.upload.js';

const imageRouter = Router();

imageRouter.post(
  '/compress',
  initializeTaskProgress('image_compress'),
  imageUpload.array('files'),
  compressImagesController,
);

export { imageRouter };
