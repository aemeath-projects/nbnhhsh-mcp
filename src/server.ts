import { McpServer, type McpServerFactory } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { DEFAULT_NBNHHSH_CONFIG } from './nbnhhsh/config.js'
import { NbnhhshService } from './nbnhhsh/service.js'
import { registerExplainTextTool, registerGuessTool } from './nbnhhsh/tools.js'
import { SERVER_NAME, SERVER_VERSION } from './version.js'

const SERVER_INSTRUCTIONS = `本服务器用于解释中文互联网中的拼音首字母缩写。
查询裸缩写使用 guess；理解整句时使用 explain_text，它会提取文本中的缩写并返回出现位置。
释义来自社区词库，按相关度排序，可能包含不适宜内容，需结合上下文选择。`

/** 零参数 `createServer()` 使用的默认 service，缓存随模块生命周期共享。 */
const DEFAULT_SERVICE = new NbnhhshService(DEFAULT_NBNHHSH_CONFIG)

/**
 * 创建一个 MCP Server 实例。
 *
 * SDK 的 `McpServerFactory` 会把 `McpRequestContext` 作为第一个参数传入，
 * 因此这里刻意保持零参数，避免上下文被误认为配置项。需要自定义配置时使用
 * `createServerWithService` 或 `createServerFactory`。
 */
export function createServer(): McpServer {
  return createServerWithService(DEFAULT_SERVICE)
}

export function createServerWithService(service: NbnhhshService): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  )

  registerPingTool(server)
  registerGuessTool(server, service)
  registerExplainTextTool(server, service)

  return server
}

/**
 * 返回每请求调用的工厂。
 *
 * `service` 必须在调用本函数前创建并由闭包捕获：`createMcpHandler` 会为每个
 * 请求调用工厂，若在工厂内部创建 service，缓存将完全失效。
 */
export function createServerFactory(service: NbnhhshService): McpServerFactory {
  return () => createServerWithService(service)
}

function registerPingTool(server: McpServer): void {
  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: '健康检查工具，始终返回 pong。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    () => ({
      content: [{ type: 'text', text: 'pong' }],
    }),
  )
}
