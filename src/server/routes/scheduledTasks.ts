import { Router } from 'express';
import { getScheduledTaskStore, getScheduler } from '../services/init';

export const scheduledTasksRouter = Router();

// GET /api/scheduled-tasks
scheduledTasksRouter.get('/', async (_req, res) => {
  try {
    const tasks = getScheduledTaskStore().listTasks();
    res.json({ success: true, tasks });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// GET /api/scheduled-tasks/runs/all
scheduledTasksRouter.get('/runs/all', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const runs = getScheduledTaskStore().listAllRuns(limit, offset);
    res.json({ success: true, runs });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// GET /api/scheduled-tasks/:id
scheduledTasksRouter.get('/:id', async (req, res) => {
  try {
    const task = getScheduledTaskStore().getTask(req.params.id);
    res.json({ success: true, task });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// POST /api/scheduled-tasks
scheduledTasksRouter.post('/', async (req, res) => {
  try {
    const task = getScheduledTaskStore().createTask(req.body);
    getScheduler().reschedule();
    res.json({ success: true, task });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// PUT /api/scheduled-tasks/:id
scheduledTasksRouter.put('/:id', async (req, res) => {
  try {
    const task = getScheduledTaskStore().updateTask(req.params.id, req.body);
    if (task) getScheduler().reschedule();
    res.json({ success: true, task });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// DELETE /api/scheduled-tasks/:id
scheduledTasksRouter.delete('/:id', async (req, res) => {
  try {
    getScheduledTaskStore().deleteTask(req.params.id);
    getScheduler().reschedule();
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// PUT /api/scheduled-tasks/:id/toggle
scheduledTasksRouter.put('/:id/toggle', async (req, res) => {
  try {
    const result = getScheduledTaskStore().toggleTask(req.params.id, req.body.enabled);
    getScheduler().reschedule();
    res.json({ success: true, task: result.task, warning: result.warning });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// POST /api/scheduled-tasks/:id/run
scheduledTasksRouter.post('/:id/run', async (req, res) => {
  try {
    await getScheduler().runManually(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// POST /api/scheduled-tasks/:id/stop
scheduledTasksRouter.post('/:id/stop', async (req, res) => {
  try {
    getScheduler().stopTask(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// GET /api/scheduled-tasks/:id/runs
scheduledTasksRouter.get('/:id/runs', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const runs = getScheduledTaskStore().listRuns(req.params.id, limit, offset);
    res.json({ success: true, runs });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// GET /api/scheduled-tasks/:id/runs/count
scheduledTasksRouter.get('/:id/runs/count', async (req, res) => {
  try {
    const count = getScheduledTaskStore().countRuns(req.params.id);
    res.json({ success: true, count });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});
