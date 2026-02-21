import { Router } from 'express';
import { compressImagesController } from './image.controller.js';
import { imageUpload } from './image.upload.js';

const imageRouter = Router();

imageRouter.post('/compress', imageUpload.array('files'), compressImagesController);

export { imageRouter };
