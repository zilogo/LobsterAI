# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Electron mode - starts Vite dev server (port 5175) + Electron app with hot reload
npm run electron:dev

# Web mode - starts Vite (port 5176) + Express backend (port 3001)
npm run web:dev

# Build production bundles
npm run build              # Electron: TypeScript + Vite
npm run web:build          # Web: Vite + server TypeScript compilation
npm run web:start          # Web: start production server

# Lint with ESLint
npm run lint

# Run memory extractor tests (Node.js built-in test runner)
npm run test:memory

# Compile individual targets
npm run compile:electron   # Electron main process only
npm run compile:server     # Web server only (output: dist-server/)

# Package for distribution (platform-specific)
npm run dist:mac        # macOS (.dmg)
npm run dist:win        # Windows (.exe)
npm run dist:linux      # Linux (.AppImage)
```

**Requirements**: Node.js >=24 <25. Windows builds require PortableGit (see README.md for setup).

## Architecture Overview

LobsterAI is a React application that runs in two modes:
1. **Electron Mode** - Desktop app with IPC communication between main/renderer processes
2. **Web Mode** - Pure browser app backed by Express + WebSocket server

Core feature: **Cowork Mode** — AI-assisted coding sessions using Claude Agent SDK with tool execution.

The same frontend code runs in both modes via the **Platform Adapter** pattern (`IPlatformAdapter`).

### Process Model

#### Electron Mode

**Main Process** (`src/main/main.ts`):
- Window lifecycle management
- SQLite storage via `sql.js` (`src/main/sqliteStore.ts`)
- Cowork session runner (`src/main/libs/coworkRunner.ts`) - executes Claude Agent SDK
- IPC handlers for store, cowork, and API operations
- Security: context isolation enabled, node integration disabled, sandbox enabled

**Preload Script** (`src/main/preload.ts`):
- Exposes `window.electron` API via `contextBridge`
- Includes `cowork` namespace for session management and streaming events

**Renderer Process** (React in `src/renderer/`):
- All UI and business logic
- Communicates with main process through IPC via `ElectronAdapter`

#### Web Mode

**Express Server** (`src/server/index.ts`):
- REST API endpoints mapping all 95 IPC channels (`src/server/routes/`)
- WebSocket server for real-time event push (`src/server/ws/`)
- Reuses all `src/main/` core modules (SqliteStore, CoworkRunner, SkillManager, etc.)
- Services initialized via `src/server/services/init.ts` with `AppContext` injection

**Browser Client** (same React SPA):
- `WebAdapter` injects into `window.electron` at startup (`src/renderer/main.tsx`)
- REST calls for request/response, WebSocket for streaming events
- `WebSocketManager` provides auto-reconnect (exponential backoff) + heartbeat

### Key Directories

```
src/main/                        # Shared core logic (Electron + Web)
├── main.ts                      # Electron entry point, IPC handlers
├── sqliteStore.ts               # SQLite database (kv + cowork tables)
├── coworkStore.ts               # Cowork session/message CRUD operations
├── skillManager.ts              # Skill loading, routing prompt generation
├── im/                          # IM gateway integrations (DingTalk, Feishu, Telegram, etc.)
└── libs/
    ├── coworkRunner.ts          # Claude Agent SDK execution engine
    ├── coworkVmRunner.ts        # Sandbox VM execution mode
    ├── coworkOpenAICompatProxy.ts # OpenAI-compatible API proxy for Claude SDK
    ├── claudeSdk.ts             # SDK loader utilities
    ├── coworkMemoryExtractor.ts # Extracts memory changes from conversations
    └── coworkMemoryJudge.ts     # Validates memory candidates with scoring/LLM

src/renderer/
├── main.tsx             # Entry point (injects WebAdapter in Web mode)
├── platform/            # Platform abstraction layer
│   ├── index.ts         # isElectron() detection + getAdapter() factory
│   ├── ElectronAdapter.ts  # Proxies window.electron (zero overhead)
│   ├── WebAdapter.ts       # HTTP REST + WebSocket client
│   └── WebSocketManager.ts # Auto-reconnect + heartbeat
├── store/slices/
│   └── coworkSlice.ts   # Cowork sessions and streaming state
├── services/
│   ├── cowork.ts        # Cowork service (IPC wrapper, Redux integration)
│   └── api.ts           # LLM API with SSE streaming
├── components/
│   └── cowork/          # Cowork UI components
│       ├── CoworkView.tsx          # Main cowork interface
│       ├── CoworkSessionList.tsx   # Session sidebar
│       ├── CoworkSessionDetail.tsx # Message display
│       └── CoworkPermissionModal.tsx # Tool permission UI

src/server/                      # Web mode Express backend
├── index.ts                     # Server startup entry
├── app.ts                       # Express config, CORS, static files
├── ws/index.ts                  # WebSocket server + broadcast
├── services/init.ts             # Service initialization (AppContext injection)
├── middleware/                   # Auth, error handling
└── routes/                      # REST API (store, cowork, skills, mcp, im, files, etc.)

src/shared/types/
└── platform.ts                  # IPlatformAdapter interface definition

SKILLs/                          # Custom skill definitions for cowork sessions
├── skills.config.json           # Skill enable/order configuration
├── docx/                        # Word document generation skill
├── xlsx/                        # Excel skill
├── pptx/                        # PowerPoint skill
└── ...
```

### Platform Adapter Pattern

Frontend code uses `window.electron.*` API calls everywhere. The platform layer makes this work in both modes:

- **Electron**: `ElectronAdapter` directly proxies `window.electron` (set by preload script)
- **Web**: `WebAdapter` is injected as `window.electron` at startup, translating calls to REST/WebSocket

```
Frontend code → window.electron.cowork.startSession(...)
                        ↓ (Electron)              ↓ (Web)
                   IPC to main process     POST /api/cowork/sessions/start
```

`src/main/` modules use conditional Electron imports (`try { require('electron') } catch {}`) so they can run in both Electron and plain Node.js (Express server) contexts.

### Data Flow

1. **Initialization**: `src/renderer/App.tsx` → `coworkService.init()` → loads config/sessions via adapter → sets up stream listeners
2. **Cowork Session**: User sends prompt → adapter call → `CoworkRunner.startSession()` → Claude Agent SDK execution → streaming events back via IPC (Electron) or WebSocket (Web) → Redux updates
3. **Tool Permissions**: Claude requests tool use → `CoworkRunner` emits `permissionRequest` → UI shows `CoworkPermissionModal` → user approves/denies → result sent back to SDK
4. **Persistence**: Cowork sessions stored in SQLite (`cowork_sessions`, `cowork_messages` tables), shared between Electron and Web modes

### Cowork System

The Cowork feature provides AI-assisted coding sessions:

**Execution Modes** (`CoworkExecutionMode`):
- `auto` - Automatically choose based on context
- `local` - Run tools directly on the local machine
- `sandbox` - Run tools in isolated VM environment

**Memory System**: Automatically extracts and manages user memories from conversations:
- `coworkMemoryExtractor.ts` - Detects explicit remember/forget commands (Chinese/English) and implicitly extracts personal facts using signal patterns (profile, preferences, ownership). Uses guard levels (`strict`/`standard`/`relaxed`) with confidence thresholds.
- `coworkMemoryJudge.ts` - Validates memory candidates with rule-based scoring and optional LLM secondary judgment for borderline cases. Includes TTL-based caching for LLM results.

**Stream Events** (IPC in Electron / WebSocket in Web):
- `message` - New message added to session
- `messageUpdate` - Streaming content update for existing message
- `permissionRequest` - Tool needs user approval
- `complete` - Session execution finished
- `error` - Session encountered an error

**Key IPC Channels / REST Endpoints**:
- `cowork:startSession` → `POST /api/cowork/sessions/start`
- `cowork:continueSession` → `POST /api/cowork/sessions/continue`
- `cowork:stopSession` → `POST /api/cowork/sessions/:id/stop`
- `cowork:getSession` → `GET /api/cowork/sessions/:id`
- `cowork:listSessions` → `GET /api/cowork/sessions`
- `cowork:deleteSession` → `DELETE /api/cowork/sessions/:id`
- `cowork:respondToPermission` → `POST /api/cowork/permission/respond`
- `cowork:getConfig` → `GET /api/cowork/config`
- `cowork:setConfig` → `PUT /api/cowork/config`

### Key Patterns

- **Streaming responses**: `apiService.chat()` uses SSE with `onProgress` callback for real-time message updates
- **Cowork streaming**: IPC event listeners (Electron) or WebSocket events (Web) for `onStreamMessage`, `onStreamMessageUpdate`, etc.
- **Conditional Electron imports**: All `src/main/` modules use `try { require('electron').app } catch { null }` with optional chaining (`app?.isPackaged`), falling back to `os.homedir()` for paths
- **Markdown rendering**: `react-markdown` with `remark-gfm`, `remark-math`, `rehype-katex` for GitHub markdown and LaTeX
- **Theme system**: Class-based Tailwind dark mode, applies `dark` class to `<html>` element
- **i18n**: Simple key-value translation in `services/i18n.ts`, supports Chinese (default) and English. Language auto-detected from system locale on first run.
- **Path alias**: `@` maps to `src/renderer/` in Vite config for imports.
- **Skills**: Custom skill definitions in `SKILLs/` directory, configured via `skills.config.json`. Skills are injected into Cowork system prompts via `SkillManager.buildAutoRoutingPrompt()`.

### Configuration

- App config stored in SQLite `kv` table
- Cowork config stored in `cowork_config` table (workingDirectory, systemPrompt, executionMode)
- Cowork sessions and messages stored in `cowork_sessions` and `cowork_messages` tables
- Database file: `lobsterai.sqlite` in user data directory

### TypeScript Configuration

- `tsconfig.json`: React/renderer code (ES2020, ESNext modules)
- `electron-tsconfig.json`: Electron main process (CommonJS output to `dist-electron/`)
- `tsconfig.server.json`: Web server (CommonJS output to `dist-server/`)

### Key Dependencies

- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK for cowork sessions
- `sql.js` - SQLite database for persistence
- `express` - Web mode HTTP server
- `ws` - WebSocket server (Web mode event push)
- `react-markdown`, `remark-gfm`, `rehype-katex` - Markdown rendering with math support
- `dompurify` - HTML sanitization

## Coding Style & Naming Conventions

- Use TypeScript, functional React components, and Hooks; keep logic in `src/renderer/services/` when it is not UI-specific.
- Match existing formatting: 2-space indentation, single quotes, and semicolons.
- Naming: `PascalCase` for components (e.g., `Chat.tsx`), `camelCase` for functions/vars, and `*Slice.ts` for Redux slices.
- Tailwind CSS is the primary styling approach; prefer utility classes over bespoke CSS.

## Testing Guidelines

- Tests use Node.js built-in `node:test` module (no Jest/Mocha/Vitest).
- Run tests: `npm run test:memory` (compiles Electron main process first, then runs `tests/coworkMemoryExtractor.test.mjs`).
- Test files live in `tests/` directory and import compiled output from `dist-electron/`.
- Validate UI changes manually in both modes:
  - Electron: `npm run electron:dev`
  - Web: `npm run web:dev` → open http://localhost:5176/
  - Key flows: start Cowork session, send prompts, approve/deny tool permissions, stop session
  - Settings: theme switching, language switching
- Keep console warnings/errors clean; lint via `npm run lint` before submitting.

## Commit & Pull Request Guidelines

- Recent history uses conventional prefixes like `feat:`, `refactor:`, and `chore:`; older commits include `feature:` and `Initial commit`.
- Prefer `type: short imperative summary` (e.g., `feat: add artifact toolbar actions`).
- PRs should include a concise description, linked issue if applicable, and screenshots for UI changes.
- Call out any Electron-specific behavior changes (IPC, storage, windowing) in the PR description.
- When modifying `src/main/` modules, ensure changes work in both Electron and Node.js contexts (no bare `electron` imports).

### Web Mode Known Limitations

- `selectDirectory`: Uses browser `prompt()` dialog (no native folder picker)
- `selectFile/selectFiles`: Uses HTML5 `<input type="file">` (files uploaded to server, not direct path access)
- Window controls (minimize/maximize/close): No-op in Web mode
- Auto-launch / app update: No-op in Web mode
- Sandbox execution mode: Not yet supported in Web mode
