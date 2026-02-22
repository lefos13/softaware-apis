/**
 * Why this exists: long-running file tasks need a shared in-memory progress
 * channel so frontend polling can show real backend processing state.
 */

const TASK_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const tasks = new Map();

const cleanupExpiredTasks = () => {
  const now = Date.now();

  for (const [taskId, task] of tasks.entries()) {
    if (now - task.updatedAtMs > TASK_TTL_MS) {
      tasks.delete(taskId);
    }
  }
};

const cleanupTimer = setInterval(cleanupExpiredTasks, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

const clampProgress = (value) => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.min(100, Math.max(0, parsed));
};

export const startTaskProgress = (taskId, payload = {}) => {
  if (!taskId) {
    return;
  }

  const nowIso = new Date().toISOString();

  tasks.set(taskId, {
    taskId,
    status: 'running',
    progress: 0,
    step: payload.step || 'Task accepted',
    operation: payload.operation || 'generic_operation',
    metadata: payload.metadata || {},
    error: null,
    startedAt: nowIso,
    completedAt: null,
    updatedAt: nowIso,
    updatedAtMs: Date.now(),
  });
};

export const updateTaskProgress = (taskId, payload = {}) => {
  const task = tasks.get(taskId);

  if (!task || task.status !== 'running') {
    return;
  }

  task.progress = clampProgress(payload.progress ?? task.progress);
  task.step = payload.step || task.step;
  task.updatedAt = new Date().toISOString();
  task.updatedAtMs = Date.now();

  if (payload.metadata && typeof payload.metadata === 'object') {
    task.metadata = {
      ...task.metadata,
      ...payload.metadata,
    };
  }
};

export const completeTaskProgress = (taskId, step = 'Task completed') => {
  const task = tasks.get(taskId);

  if (!task) {
    return;
  }

  const nowIso = new Date().toISOString();
  task.status = 'completed';
  task.progress = 100;
  task.step = step;
  task.completedAt = nowIso;
  task.updatedAt = nowIso;
  task.updatedAtMs = Date.now();
};

export const failTaskProgress = (taskId, error = {}) => {
  const task = tasks.get(taskId);

  if (!task || task.status === 'completed') {
    return;
  }

  const nowIso = new Date().toISOString();
  task.status = 'failed';
  task.step = error.step || 'Task failed';
  task.error = {
    code: error.code || 'INTERNAL_SERVER_ERROR',
    message: error.message || 'Unexpected error occurred',
  };
  task.completedAt = nowIso;
  task.updatedAt = nowIso;
  task.updatedAtMs = Date.now();
};

export const getTaskProgress = (taskId) => {
  cleanupExpiredTasks();
  return tasks.get(taskId) || null;
};
