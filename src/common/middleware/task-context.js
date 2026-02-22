/**
 * Why this exists: task id/progress must be initialized before upload parsing
 * so frontend polling never races against task creation.
 */
import { randomUUID } from 'node:crypto';
import { startTaskProgress } from '../services/task-progress-store.js';

export const initializeTaskProgress = (operation) => (req, res, next) => {
  const queryTaskId = String(req.query?.taskId || '').trim();
  const headerTaskId = String(req.get('x-task-id') || '').trim();
  const taskId = queryTaskId || headerTaskId || randomUUID();

  req.taskId = taskId;
  res.setHeader('X-Task-Id', taskId);

  startTaskProgress(taskId, {
    operation,
    step: 'Request received, awaiting upload',
  });

  next();
};
