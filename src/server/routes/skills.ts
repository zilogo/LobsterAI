import { Router } from 'express';
import { getSkillManager } from '../services/init';
import { broadcast } from '../ws';

export const skillsRouter = Router();

// GET /api/skills
skillsRouter.get('/', (_req, res) => {
  try {
    const skills = getSkillManager().listSkills();
    res.json({ success: true, skills });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to load skills' });
  }
});

// PUT /api/skills/:id/enabled
skillsRouter.put('/:id/enabled', (req, res) => {
  try {
    const skills = getSkillManager().setSkillEnabled(req.params.id, req.body.enabled);
    broadcast('skills:changed', {});
    res.json({ success: true, skills });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to update skill' });
  }
});

// DELETE /api/skills/:id
skillsRouter.delete('/:id', (req, res) => {
  try {
    const skills = getSkillManager().deleteSkill(req.params.id);
    broadcast('skills:changed', {});
    res.json({ success: true, skills });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to delete skill' });
  }
});

// POST /api/skills/download
skillsRouter.post('/download', async (req, res) => {
  try {
    const result = await getSkillManager().downloadSkill(req.body.source);
    broadcast('skills:changed', {});
    res.json(result);
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to download skill' });
  }
});

// GET /api/skills/root
skillsRouter.get('/root', (_req, res) => {
  try {
    const root = getSkillManager().getSkillsRoot();
    res.json({ success: true, path: root });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to resolve skills root' });
  }
});

// GET /api/skills/auto-routing-prompt
skillsRouter.get('/auto-routing-prompt', (_req, res) => {
  try {
    const prompt = getSkillManager().buildAutoRoutingPrompt();
    res.json({ success: true, prompt });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to build auto-routing prompt' });
  }
});

// GET /api/skills/:id/config
skillsRouter.get('/:id/config', (req, res) => {
  try {
    const result = getSkillManager().getSkillConfig(req.params.id);
    res.json(result);
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to get skill config' });
  }
});

// PUT /api/skills/:id/config
skillsRouter.put('/:id/config', (req, res) => {
  try {
    const result = getSkillManager().setSkillConfig(req.params.id, req.body.config);
    res.json(result);
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to set skill config' });
  }
});

// POST /api/skills/:id/test-email
skillsRouter.post('/:id/test-email', async (req, res) => {
  try {
    const result = await getSkillManager().testEmailConnectivity(req.params.id, req.body.config);
    res.json(result);
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to test email connectivity' });
  }
});
