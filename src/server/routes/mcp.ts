import { Router } from 'express';
import https from 'https';
import { getMcpStore, getAppContext } from '../services/init';

export const mcpRouter = Router();

// GET /api/mcp
mcpRouter.get('/', (_req, res) => {
  try {
    const servers = getMcpStore().listServers();
    res.json({ success: true, servers });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to list MCP servers' });
  }
});

// POST /api/mcp
mcpRouter.post('/', (req, res) => {
  try {
    getMcpStore().createServer(req.body);
    const servers = getMcpStore().listServers();
    res.json({ success: true, servers });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to create MCP server' });
  }
});

// PUT /api/mcp/:id
mcpRouter.put('/:id', (req, res) => {
  try {
    getMcpStore().updateServer(req.params.id, req.body);
    const servers = getMcpStore().listServers();
    res.json({ success: true, servers });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to update MCP server' });
  }
});

// DELETE /api/mcp/:id
mcpRouter.delete('/:id', (req, res) => {
  try {
    getMcpStore().deleteServer(req.params.id);
    const servers = getMcpStore().listServers();
    res.json({ success: true, servers });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to delete MCP server' });
  }
});

// PUT /api/mcp/:id/enabled
mcpRouter.put('/:id/enabled', (req, res) => {
  try {
    getMcpStore().setEnabled(req.params.id, req.body.enabled);
    const servers = getMcpStore().listServers();
    res.json({ success: true, servers });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to update MCP server' });
  }
});

// GET /api/mcp/marketplace
mcpRouter.get('/marketplace', async (_req, res) => {
  const ctx = getAppContext();
  const url = ctx.isPackaged
    ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/mcp-marketplace'
    : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/test/mcp-marketplace';
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const req = https.get(url, { timeout: 10000 }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          response.resume();
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { body += chunk; });
        response.on('end', () => resolve(body));
        response.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    });
    const json = JSON.parse(data);
    const value = json?.data?.value;
    if (!value) {
      res.json({ success: false, error: 'Invalid response: missing data.value' });
      return;
    }
    const marketplace = typeof value === 'string' ? JSON.parse(value) : value;
    res.json({ success: true, data: marketplace });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to fetch marketplace' });
  }
});
