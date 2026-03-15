# LobsterAI Web 模式部署指南

本文档描述如何在 Linux 服务器上以 Web 模式部署 LobsterAI。

## 1. 环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Ubuntu 20.04+ / Debian 11+ / CentOS 8+（任何支持 Node.js 的 Linux） |
| Node.js | **>=24 <25**（项目 `.npmrc` 中 `engine-strict=true` 会强制检查） |
| 内存 | 建议 4GB+（AI 对话会话消耗较多内存） |
| 磁盘 | 1GB+（代码 + 依赖约 500MB，数据库和日志按使用量增长） |

## 2. 安装 Node.js

推荐使用 nvm 管理 Node.js 版本：

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc

# 安装 Node.js 24
nvm install 24
nvm use 24
node -v  # 应输出 v24.x.x
```

## 3. 安装 pm2

```bash
npm install -g pm2
```

设置开机自启：

```bash
pm2 startup
# 按提示执行输出的 sudo 命令
```

## 4. 部署代码

### 方式 A：从开发机 rsync 同步（推荐）

在**开发机**上执行：

```bash
rsync -avz \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'dist-electron' \
  --exclude 'dist-server' \
  --exclude 'release' \
  --exclude '.git' \
  --exclude '*.sqlite' \
  -e "ssh -o StrictHostKeyChecking=no" \
  /path/to/local/LobsterAI/ \
  user@server-ip:/path/to/remote/LobsterAI/
```

### 方式 B：git clone

```bash
git clone <repo-url> /home/<user>/Projects/LobsterAI
cd /home/<user>/Projects/LobsterAI
```

## 5. 安装依赖

```bash
cd /path/to/LobsterAI

# 必须使用 --ignore-scripts 跳过 postinstall 中的 electron-builder
npm install --ignore-scripts

# 手动执行 patch-package（如有补丁）
npx patch-package
```

**关键**：安装完成后**删除 electron 包**，Web 模式不需要它，保留会导致启动崩溃：

```bash
rm -rf node_modules/electron
```

## 6. 构建

```bash
npm run web:build
```

此命令会依次执行：
1. `vite build` — 编译前端资源到 `dist-web/`
2. `tsc --project tsconfig.server.json` — 编译服务端代码到 `dist-server/`

## 7. 创建目录结构

```bash
# 数据目录（SQLite 数据库存放位置）
mkdir -p ~/.assistant

# 工作目录（Cowork 会话的工作空间，AI 读写文件的根目录）
mkdir -p ~/assistant/project
```

> 数据目录路径 `~/.assistant/` 是 Web 模式的默认 userData 目录，包含 `lobsterai.sqlite` 数据库文件。
> 工作目录可自定义，通过环境变量 `COWORK_WORKING_DIRECTORY` 或应用内设置页面配置。

## 8. 配置 pm2

创建 `ecosystem.config.cjs`：

```bash
cat > /path/to/LobsterAI/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: "lobsterai",
    script: "dist-server/src/server/index.js",
    cwd: "/path/to/LobsterAI",
    env: {
      NODE_ENV: "production",
      PORT: 3001,
      HOST: "0.0.0.0",

      // Cowork 工作目录
      COWORK_WORKING_DIRECTORY: "/home/<user>/assistant/project",

      // 选择性代理（可选）— 只有白名单域名走代理，其余直连
      // 留空表示不使用代理
      PROXY_URL: "",
      PROXY_DOMAINS: "",
    },
  }],
};
EOF
```

**需要根据实际情况修改的字段：**

| 字段 | 说明 | 示例 |
|---|---|---|
| `cwd` | 项目代码路径 | `/home/laiye/Projects/LobsterAI` |
| `PORT` | HTTP 服务端口 | `3001` |
| `HOST` | 监听地址，`0.0.0.0` 允许外部访问 | `0.0.0.0` |
| `COWORK_WORKING_DIRECTORY` | AI 工作空间根目录 | `/home/laiye/assistant/project` |
| `PROXY_URL` | 代理地址（见下方代理章节） | `http://172.16.10.3:10811` |
| `PROXY_DOMAINS` | 需走代理的域名白名单（逗号分隔） | `github.com,google.com` |

## 9. 启动服务

```bash
cd /path/to/LobsterAI
pm2 start ecosystem.config.cjs
pm2 save    # 保存进程列表，开机自启时恢复
```

启动后访问 `http://<server-ip>:3001` 即可使用。

## 10. 代理配置

### 工作原理

LobsterAI 采用**选择性代理（白名单模式）**：只有指定域名的请求走代理，其余所有请求直连。

这与传统的 `HTTP_PROXY` + `NO_PROXY`（全部代理、排除部分）相反——白名单模式更安全，不会意外影响飞书等 IM 平台的 API 调用。

**技术实现**：服务启动时通过 undici `setGlobalDispatcher` 注入一个 `SelectiveProxyDispatcher`，对进程内所有 `globalThis.fetch` 调用全局生效，无需逐调用点处理。`git clone` 子进程也会自动注入代理环境变量。

### 配置方法

在 `ecosystem.config.cjs` 的 `env` 中设置两个环境变量：

```javascript
// 代理服务器地址
PROXY_URL: "http://172.16.10.3:10811",

// 需要走代理的域名白名单（逗号分隔）
// 支持子域名匹配：填 github.com 会同时匹配 api.github.com
PROXY_DOMAINS: "github.com,google.com,googleapis.com,telegram.org,yahoo.com",
```

修改后需重新启动（**注意：`pm2 restart` 不会刷新环境变量**，必须 delete + start）：

```bash
pm2 delete lobsterai
pm2 start ecosystem.config.cjs
pm2 save
```

### 域名匹配规则

- 精确匹配：`github.com` 匹配 `github.com`
- 子域名匹配：`github.com` 同时匹配 `api.github.com`、`raw.githubusercontent.com` 不会匹配（需单独添加）
- 不在白名单中的域名一律直连

### 常用代理域名参考

| 域名 | 用途 |
|---|---|
| `github.com` | GitHub Skill 导入（git clone + archive 下载） |
| `google.com` | Google 搜索 |
| `googleapis.com` | Google API |
| `telegram.org` | Telegram Bot API |
| `yahoo.com` | Yahoo 搜索 |

根据实际需要增减域名，多个域名用逗号分隔。

### 验证代理是否生效

服务启动日志中会打印：

```
[Proxy] Selective proxy enabled: http://172.16.10.3:10811
[Proxy] Proxied domains: github.com, google.com, googleapis.com, telegram.org, yahoo.com
```

如果没有看到此日志，说明 `PROXY_URL` 或 `PROXY_DOMAINS` 为空，代理未启用。

查看启动日志：

```bash
pm2 logs lobsterai --lines 30 --nostream
```

### 不需要代理的情况

如果服务器可以直连外网，将 `PROXY_URL` 和 `PROXY_DOMAINS` 留空即可，所有请求直连，不影响任何功能。

## 11. 常用运维命令

```bash
pm2 status                              # 查看服务状态
pm2 logs lobsterai                      # 实时查看日志
pm2 logs lobsterai --lines 50 --nostream  # 查看最近 50 行日志
pm2 restart lobsterai                   # 重启服务
pm2 stop lobsterai                      # 停止服务
pm2 delete lobsterai                    # 删除进程（重新 start 前需要）
pm2 save                                # 保存进程列表（开机自启用）
```

## 12. 更新部署

### 从开发机同步更新

```bash
# 1. 开发机：确认编译通过
npm run compile:server

# 2. 开发机：rsync 同步代码
rsync -avz \
  --exclude 'node_modules' --exclude 'dist' --exclude 'dist-electron' \
  --exclude 'dist-server' --exclude 'release' --exclude '.git' --exclude '*.sqlite' \
  -e "ssh -o StrictHostKeyChecking=no" \
  /path/to/local/LobsterAI/ \
  user@server-ip:/path/to/remote/LobsterAI/

# 3. 服务器：重新构建并重启
ssh user@server-ip
cd /path/to/LobsterAI
npm run web:build
pm2 restart lobsterai
```

### 依赖更新

如果 `package.json` 有变动，需重新安装依赖：

```bash
npm install --ignore-scripts
npx patch-package
rm -rf node_modules/electron
npm run web:build
pm2 restart lobsterai
```

## 13. 故障排查

### 服务启动失败

```bash
# 查看错误日志
pm2 logs lobsterai --lines 100 --nostream

# 常见原因：
# 1. Node.js 版本不对 → nvm use 24
# 2. node_modules/electron 未删除 → rm -rf node_modules/electron
# 3. 依赖缺失 → npm install --ignore-scripts && npx patch-package
```

### GitHub Skill 导入失败

```bash
# 检查代理是否配置
pm2 env 0 | grep -i proxy

# 测试代理连通性
curl -x http://代理IP:端口 https://github.com

# 如果代理正常但仍失败，检查 PROXY_DOMAINS 是否包含了 github.com
# 检查启动日志确认代理生效
pm2 logs lobsterai --lines 30 --nostream | grep Proxy
```

### 端口被占用

```bash
lsof -i :3001
# 修改 ecosystem.config.cjs 中的 PORT，或 kill 占用进程
```

## 14. 安全建议

- 服务默认监听 `0.0.0.0:3001`，内网部署可不加认证；公网暴露建议用 Nginx 反代 + HTTPS + 访问控制
- `COWORK_WORKING_DIRECTORY` 是 AI 可读写的目录范围，不要设为 `/` 或 home 根目录
- 代理密码如包含特殊字符，URL 中需做百分号编码（如 `#` → `%23`）
- SQLite 数据库文件在 `~/.assistant/lobsterai.sqlite`，建议定期备份

## 附：完整部署一键脚本（参考）

```bash
#!/bin/bash
set -e

PROJECT_DIR="$HOME/Projects/LobsterAI"
DATA_DIR="$HOME/.assistant"
WORK_DIR="$HOME/assistant/project"

echo "=== 安装 Node.js 24 ==="
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24

echo "=== 安装 pm2 ==="
npm install -g pm2

echo "=== 创建目录 ==="
mkdir -p "$DATA_DIR" "$WORK_DIR"

echo "=== 安装依赖 ==="
cd "$PROJECT_DIR"
npm install --ignore-scripts
npx patch-package
rm -rf node_modules/electron

echo "=== 构建 ==="
npm run web:build

echo "=== 创建 pm2 配置 ==="
cat > ecosystem.config.cjs << PMEOF
module.exports = {
  apps: [{
    name: "lobsterai",
    script: "dist-server/src/server/index.js",
    cwd: "$PROJECT_DIR",
    env: {
      NODE_ENV: "production",
      PORT: 3001,
      HOST: "0.0.0.0",
      COWORK_WORKING_DIRECTORY: "$WORK_DIR",
      // 选择性代理（可选）— 只有白名单域名走代理，其余直连
      PROXY_URL: "",
      PROXY_DOMAINS: "",
    },
  }],
};
PMEOF

echo "=== 启动服务 ==="
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup

echo "=== 部署完成 ==="
echo "访问地址: http://$(hostname -I | awk '{print $1}'):3001"
```
