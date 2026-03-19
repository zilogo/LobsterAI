# 生产环境部署与运维

本文档记录 LobsterAI 内部生产环境的服务器信息、部署策略和运维操作。

> 通用的 Web 模式部署步骤请参考 [web-deployment-guide.md](./web-deployment-guide.md)。

## 1. 服务器信息

| 项目 | 主服务器（源码+编译） | 副服务器（仅产出物） |
|---|---|---|
| IP | 172.16.13.76 | 172.16.13.74 |
| OS | Ubuntu 22.04.5 LTS (94GB RAM, 1TB Disk) | Ubuntu 22.04.5 LTS (15GB RAM, 193GB Disk) |
| 用户 | laiye / Laiye123# | laiye / Laiye123# |
| Node.js | v24.14.0 (via nvm) | v24.14.0 (via nvm，从 .76 复制) |
| 部署路径 | /home/laiye/Projects/LobsterAI | /home/laiye/Projects/LobsterAI |
| 部署内容 | 完整项目（源码+构建产物） | **仅运行时产出物**（dist-server, dist-web, node_modules, SKILLs, ecosystem.config.js, package.json, brand.config.json） |
| 工作目录 | /home/laiye/assistant/project | /home/laiye/assistant/project |
| 数据目录 | /home/laiye/.assistant/ (SQLite 数据库等) | /home/laiye/.assistant/ (SQLite 数据库等) |
| 访问地址 | http://172.16.13.76:3001 | http://172.16.13.74:3001 |
| 进程管理 | pm2 (进程名: lobsterai) | pm2 (进程名: lobsterai) |
| 开机自启 | systemd (pm2-laiye.service) | systemd (pm2-laiye.service) |

## 2. 部署策略

- **.76 为主服务器**：接收源码同步、执行编译构建
- **.74 为副服务器**：不存放源码，只从 .76 同步编译后的产出物（dist-server、node_modules、SKILLs 等）
- .74 无法直连 GitHub，nvm/Node.js 均从 .76 复制

## 3. 部署注意事项

- `node_modules/electron` 已删除（服务器仅需 Web 模式，electron 包会导致启动崩溃）
- 安装依赖使用 `npm install --ignore-scripts`（跳过 postinstall 中的 electron-builder），然后手动 `npx patch-package`
- `src/main/libs/systemProxy.ts` 已修改为条件导入 electron，避免 Web 模式启动报错
- 编译 `npm run compile:server` 会有 electron 相关类型错误（预期行为，不影响 JS 输出和运行）

## 4. 同步与更新流程

### 步骤 1：本地 → .76（同步源码，远程编译）

```bash
# 1a. 本地验证编译通过
npx tsc --project tsconfig.server.json --noEmit

# 1b. 同步源码到 .76（排除构建产物）
sshpass -p 'Laiye123#' rsync -avz \
  --exclude 'node_modules' --exclude 'dist' --exclude 'dist-electron' \
  --exclude 'dist-server' --exclude 'release' --exclude '.git' --exclude '*.sqlite' \
  -e "ssh -o StrictHostKeyChecking=no" \
  /Users/leizhao/Projects/claws/LobsterAI/ \
  laiye@172.16.13.76:/home/laiye/Projects/LobsterAI/

# 1c. .76 远程编译并重启
sshpass -p 'Laiye123#' ssh -o StrictHostKeyChecking=no laiye@172.16.13.76 \
  'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && \
   cd /home/laiye/Projects/LobsterAI && \
   npm run web:build && \
   pm2 restart lobsterai'
```

### 步骤 2：.76 → .74（仅同步产出物）

```bash
sshpass -p 'Laiye123#' ssh -o StrictHostKeyChecking=no laiye@172.16.13.76 \
  "sshpass -p Laiye123# rsync -avzL \
    --include='dist-server/***' \
    --include='dist-web/***' \
    --include='node_modules/***' \
    --include='SKILLs/***' \
    --include='ecosystem.config.js' \
    --include='package.json' \
    --include='brand.config.json' \
    --exclude='*' \
    ~/Projects/LobsterAI/ laiye@172.16.13.74:~/Projects/LobsterAI/ \
    -e 'ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no'"

# .74 重启服务
sshpass -p 'Laiye123#' ssh -o StrictHostKeyChecking=no laiye@172.16.13.74 \
  'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && \
   pm2 restart lobsterai'
```

## 5. 常用运维命令

SSH 到服务器后执行：

```bash
pm2 status                                # 查看服务状态
pm2 logs lobsterai                        # 实时查看日志
pm2 logs lobsterai --lines 50 --nostream  # 查看最近 50 行日志
pm2 restart lobsterai                     # 重启服务
pm2 stop lobsterai                        # 停止服务
pm2 save                                  # 保存进程列表（开机自启用）
```

## 6. Cloudflare Tunnel（外网访问）

Web 模式可通过 Cloudflare Tunnel 暴露到外网，无需公网 IP 或域名备案。

### 启动方式

```bash
# 先启动 Web 模式
npm run web:dev

# 再启动 Cloudflare Tunnel（指向 Express 端口）
cloudflared tunnel --url http://localhost:3001
```

启动后终端会输出一个 `https://xxx.trycloudflare.com` 地址，通过该地址即可从外部访问。

### 已有的关键配置（勿删除）

1. **`vite.config.web.ts`** — `server.allowedHosts: true`：允许 Vite 接受非 localhost 的 Host header，否则 Tunnel 转发的请求会被 Vite 拒绝
2. **`src/server/app.ts`** — 开发模式反向代理重写 Host header 为 `127.0.0.1:5176`：Express 将前端请求代理到 Vite 时，将外部域名的 Host 改为本地地址，避免 Vite Host 校验失败

### 注意事项

- Quick Tunnel 每次重启会生成新的随机 URL
- 免费 Tunnel 单请求上限 100MB，但因文件上传使用 base64 编码（膨胀 ~33%），Express JSON body 限制 50MB，实际可上传文件约 **37MB**
- WebSocket 通过 Tunnel 正常工作（Cloudflare 支持 WebSocket 透传）
- 如需固定域名，需注册 Cloudflare 账号并创建 Named Tunnel

## 7. 历史修复记录

- `src/main/libs/systemProxy.ts`: 改为条件导入 electron（`try/catch`），修复 Web 模式启动崩溃
- `src/server/services/init.ts`: 添加 `startAllEnabled()` 调用，修复 IM 网关重启后不自动启动
- `src/server/routes/files.ts` + `src/main/main.ts`: `resolveInlineAttachmentDir` fallback 改为优先使用 workingDirectory 而非 `/tmp`
- `src/main/im/feishuGateway.ts` 第162行: `probeBot()` 返回 `Bot info: undefined (null)` — `response.data?.bot?.app_name` 路径不对（实际结构是 `response.bot.app_name`），不影响功能但应修复
