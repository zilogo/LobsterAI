import { Router } from 'express';
import { getStore } from '../services/init';

export const storeRouter = Router();

// GET /api/store/:key
storeRouter.get('/:key', (req, res) => {
  try {
    const value = getStore().get(req.params.key);
    res.json({ value });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/store/:key
storeRouter.put('/:key', (req, res) => {
  try {
    getStore().set(req.params.key, req.body.value);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/store/:key
storeRouter.delete('/:key', (req, res) => {
  try {
    getStore().delete(req.params.key);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
