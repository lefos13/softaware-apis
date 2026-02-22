/**
 * Why this exists: frontend polling needs a stable endpoint to query backend
 * progress state for ongoing PDF and image processing tasks.
 */
import { Router } from 'express';
import { ApiError } from '../../common/utils/api-error.js';
import { sendSuccess } from '../../common/utils/api-response.js';
import { getTaskProgress } from '../../common/services/task-progress-store.js';

const tasksRouter = Router();

tasksRouter.get('/:taskId', (req, res, next) => {
  try {
    const taskId = String(req.params.taskId || '').trim();

    if (!taskId) {
      throw new ApiError(400, 'INVALID_INPUT', 'taskId path parameter is required', {
        details: [{ field: 'taskId', issue: 'Missing task id' }],
      });
    }

    const task = getTaskProgress(taskId);

    if (!task) {
      sendSuccess(res, req, {
        message: 'Task is initializing',
        data: {
          taskId,
          status: 'running',
          progress: 0,
          step: 'Task is initializing',
          operation: 'unknown',
          metadata: {},
          error: null,
          startedAt: new Date().toISOString(),
          completedAt: null,
          updatedAt: new Date().toISOString(),
        },
      });
      return;
    }

    sendSuccess(res, req, {
      message: 'Task progress fetched successfully',
      data: task,
    });
  } catch (error) {
    next(error);
  }
});

export { tasksRouter };
