# nbnhhsh-mcp

基于 [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk) 的「能不能好好说话？」MCP Server，为 LLM 提供中文互联网拼音首字母缩写的候选释义。

同一套业务代码可同时以三种方式运行：

- **stdio**：由 Claude Desktop、Claude Code、MCP Inspector 等本地客户端拉起。
- **Streamable HTTP**：Node 原生 `node:http` + 官方 `@modelcontextprotocol/node` 适配器。
- **Cloudflare Workers**：直接导出 web-standard `fetch`，由 Cloudflare Workers Builds 自动构建部署。

当前提供 `guess`（批量查询缩写）与 `explain_text`（从文本提取并解释）两个工具。

## 功能与工具

数据来自 [itorr/nbnhhsh](https://github.com/itorr/nbnhhsh) 社区词库。释义按相关度排序，每个缩写默认返回 10 条（`limit` 可调，上限 50）。

### `guess`

批量查询缩写。输入会先 trim、小写、去重，未命中的词合并为一次上游请求，并带 TTL + LRU 缓存。

```json
{
  "words": ["yyds", "xswl", "zzzznotaword"],
  "limit": 3
}
```

每个缩写的状态：

- `translated`：有释义，`translations` 已按 `limit` 截断。
- `no-translation`：已收录，但暂无释义。
- `unknown`：未收录；`candidates` 可能是上游给出的“有可能是”。

### `explain_text`

从任意文本中提取长度 ≥2 的连续字母/数字片段（`/[a-z0-9]{2,}/gi`），查询并返回每个缩写的出现位置。

```json
{
  "text": "我永远喜欢 yyds，这波操作 xswl",
  "limit": 5
}
```

`occurrences` 中的 `start` / `end` 为 UTF-16 下标，`end` 不含；同一缩写最多记录 100 个位置，超出时 `occurrencesTruncated` 为 `true`。文本中唯一缩写超过 100 个时返回错误，请缩小文本范围。

> 释义由社区贡献、未经审核，可能包含不适宜内容。返回的是候选含义，需结合上下文判断；本服务不提供提交释义的写操作。

## 环境要求

- Node.js `>= 24.0.0`
- pnpm `12.14.0`（通过 `packageManager` 固定）

## 安装与构建

```bash
pnpm install
pnpm build
```

构建产物输出到 `dist/`：

- `dist/index.js`：公共库入口
- `dist/http.js`：web-standard HTTP handler
- `dist/cli.js`：命令行入口（含 shebang）

## stdio 模式

```bash
node dist/cli.js
# 或
pnpm start
```

Claude Code / Claude Desktop 配置示例：

```json
{
  "mcpServers": {
    "nbnhhsh": {
      "command": "node",
      "args": ["/absolute/path/to/nbnhhsh-mcp/dist/cli.js"]
    }
  }
}
```

使用 MCP Inspector 调试：

```bash
pnpm inspect
```

## HTTP 模式

```bash
node dist/cli.js --transport http
# 或
pnpm start:http
```

默认监听 `http://127.0.0.1:3000/mcp`，健康检查位于 `/health`。

```bash
# 健康检查
curl -s http://127.0.0.1:3000/health

# 列出工具
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 调用 guess
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"guess","arguments":{"words":["yyds","xswl"],"limit":3}}}'

# 调用 explain_text
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"explain_text","arguments":{"text":"我永远喜欢 yyds，这波操作 xswl","limit":3}}}'
```

Node 侧默认绑定 `127.0.0.1`，并启用 localhost 级别的 Host/Origin 校验。若需要监听
`0.0.0.0` 或通过反向代理暴露，请显式配置 `MCP_ALLOWED_HOSTS` 与 `MCP_ALLOWED_ORIGINS`。

## Cloudflare Workers

### 本地开发

```bash
pnpm worker:dev
```

默认地址为 `http://127.0.0.1:8787`，MCP 端点为 `/mcp`，健康检查为 `/health`。

```bash
pnpm worker:check   # 仅打包校验，不部署
```

### 通过 Cloudflare Workers Builds 自动部署

项目采用与 Pages 相同的「Cloudflare 侧 CI」模式：GitHub Actions 不执行部署，Cloudflare
在 `master` 分支有新提交时自动构建并发布。

1. 在 Cloudflare Dashboard → Workers & Pages 创建 Worker，选择 **Connect to Git**，绑定
   `aemeath-projects/nbnhhsh-mcp`。
2. Production branch 设为 `master`。
3. Build command：`pnpm install --frozen-lockfile`。
4. Deploy command：`pnpm worker:deploy`。
5. Build 环境变量：
   - `PNPM_VERSION=12.14.0`（Workers Builds 默认版本低于本项目要求）
   - `NODE_VERSION=24`（可选，默认已满足要求）
6. 运行时变量 `ALLOWED_HOSTS`、`ALLOWED_ORIGINS` 在 Worker 的 Settings → Variables 中配置，
   也可写入 `wrangler.jsonc` 的 `vars`。

部署完成后：

- MCP 端点：`https://<worker-domain>/mcp`
- 健康检查：`https://<worker-domain>/health`

Worker 内的缓存是 per-isolate 内存缓存，会随实例回收，命中率只是尽力而为。公开部署建议在
Cloudflare 配置 Rate Limiting，并按需收紧 `workers_dev` / `preview_urls`。

本地执行 `pnpm worker:deploy` 仅用于调试，日常发布以 Cloudflare Workers Builds 为准。

## 配置

CLI 参数优先级高于环境变量。

| CLI 参数                    | 环境变量                    | 默认值                                  | 说明                                      |
| --------------------------- | --------------------------- | --------------------------------------- | ----------------------------------------- |
| `--transport <stdio\|http>` | `MCP_TRANSPORT`             | `stdio`                                 | 传输方式                                  |
| `--host <host>`             | `MCP_HOST`                  | `127.0.0.1`                             | HTTP 监听地址                             |
| `--port <port>`             | `MCP_PORT`                  | `3000`                                  | HTTP 监听端口                             |
| `--path <path>`             | `MCP_PATH`                  | `/mcp`                                  | MCP 端点路径                              |
| —                           | `MCP_ALLOWED_HOSTS`         | 未设置                                  | 允许的 Host 主机名，逗号分隔              |
| —                           | `NBNHHSH_API_BASE`          | `https://lab.magiconch.com/api/nbnhhsh` | 上游 API 根地址                           |
| —                           | `NBNHHSH_TIMEOUT_MS`        | `8000`                                  | 上游请求超时（1000–30000 毫秒）           |
| —                           | `NBNHHSH_CACHE_TTL_MS`      | `600000`                                | 缓存有效期（0–86400000 毫秒，0 表示禁用） |
| —                           | `NBNHHSH_CACHE_MAX_ENTRIES` | `1000`                                  | 缓存容量上限（1–10000）                   |
| `--help` / `-h`             | —                           | —                                       | 显示帮助                                  |
| `--version` / `-v`          | —                           | —                                       | 显示版本                                  |

Worker 运行时使用 `ALLOWED_HOSTS`、`ALLOWED_ORIGINS`（逗号分隔），空值表示不启用对应校验。
`NBNHHSH_*` 在 Node 与 Worker 中使用同名变量；Worker 未配置时直接使用默认值。

## 开发脚本

| 脚本                | 说明                          |
| ------------------- | ----------------------------- |
| `pnpm dev`          | tsup watch 构建               |
| `pnpm lint`         | ESLint 检查                   |
| `pnpm lint:fix`     | ESLint 自动修复               |
| `pnpm format`       | Prettier 检查                 |
| `pnpm format:fix`   | Prettier 格式化               |
| `pnpm type-check`   | TypeScript 类型检查           |
| `pnpm build`        | 构建 npm 产物                 |
| `pnpm worker:dev`   | 本地 Worker 开发              |
| `pnpm worker:check` | Worker 打包校验               |
| `pnpm bump`         | 版本号、CHANGELOG、tag 与提交 |
| `pnpm commit`       | Commitizen 交互式提交         |

## 目录结构

```text
src/
├── cli.ts        # bin 入口，stdio/http 分流
├── config.ts     # CLI 与环境变量解析
├── env.ts        # 列表环境变量解析（Worker 可用）
├── http.ts       # 共享 web-standard fetch handler
├── index.ts      # 公共库 barrel
├── nbnhhsh/
│   ├── cache.ts      # TTL + LRU 缓存
│   ├── config.ts     # 上游与缓存配置解析
│   ├── constants.ts  # 输入/输出上限常量
│   ├── extract.ts    # 文本缩写提取
│   ├── service.ts    # 归一化、批量查询与缓存拼装
│   ├── tools.ts      # guess / explain_text 工具
│   ├── types.ts      # 领域类型
│   └── upstream.ts   # 上游请求、响应校验与错误分类
├── node.ts       # node:http + toNodeHandler
├── server.ts     # McpServer 工厂与工具注册
├── version.ts    # 服务名与版本号
└── worker.ts     # Cloudflare Worker 入口
```

`http.ts`、`server.ts`、`worker.ts`、`env.ts`、`version.ts` 与整个 `src/nbnhhsh/` 保持
Node-free，由 ESLint `no-restricted-imports` 约束；Node 适配器 `node.ts` 仅在 HTTP 模式下
动态加载。

## 数据来源

词条来自 [itorr/nbnhhsh](https://github.com/itorr/nbnhhsh) 的公开社区词库，通过
`https://lab.magiconch.com/api/nbnhhsh` 查询。本项目仅做查询与缓存，不存储词库，也不代表
上游立场。上游不可用或需要自建代理时，可通过 `NBNHHSH_API_BASE` 切换地址。

## License

[MIT](./LICENSE)
