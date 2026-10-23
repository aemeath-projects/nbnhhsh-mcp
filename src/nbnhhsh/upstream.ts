import { z } from 'zod'

import type { NbnhhshConfig } from './config.js'

/** 上游响应体上限，避免异常大响应占满内存。 */
const MAX_RESPONSE_LENGTH = 1024 * 1024

const upstreamItemSchema = z.object({
  name: z.string().min(1),
  trans: z.array(z.string()).nullable().optional(),
  inputting: z.array(z.string()).nullable().optional(),
})

const upstreamResponseSchema = z.array(upstreamItemSchema)

export type UpstreamItem = z.infer<typeof upstreamItemSchema>

export type UpstreamErrorCode = 'timeout' | 'network' | 'http' | 'format' | 'unknown'

export interface UpstreamErrorOptions {
  status?: number
  cause?: unknown
}

export class UpstreamError extends Error {
  readonly code: UpstreamErrorCode
  readonly status?: number

  constructor(code: UpstreamErrorCode, message: string, options: UpstreamErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'UpstreamError'
    this.code = code
    this.status = options.status
  }
}

/**
 * 调用上游 `guess` 接口并校验响应结构。
 *
 * 读取响应文本后再解析，既能限制响应体大小，也能把 JSON 错误与 zod 错误
 * 统一归类为 `format`。
 */
export async function fetchUpstream(
  words: string[],
  config: NbnhhshConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<UpstreamItem[]> {
  let response: Response
  try {
    response = await fetchImpl(`${config.apiBase}/guess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: words.join(',') }),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    throw toRequestError(error)
  }

  if (!response.ok) {
    throw new UpstreamError('http', `上游返回 HTTP ${String(response.status)}`, {
      status: response.status,
    })
  }

  let body: string
  try {
    body = await response.text()
  } catch (error) {
    throw toRequestError(error)
  }

  if (body.length > MAX_RESPONSE_LENGTH) {
    throw new UpstreamError('format', '上游响应超过大小上限')
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch (error) {
    throw new UpstreamError('format', '上游响应不是合法 JSON', { cause: error })
  }

  const parsed = upstreamResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new UpstreamError('format', '上游响应结构不符合预期', { cause: parsed.error })
  }

  return parsed.data
}

function toRequestError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) {
    return error
  }

  if (isAbortLike(error)) {
    return new UpstreamError('timeout', '上游请求超时', { cause: error })
  }

  return new UpstreamError('network', '无法连接上游服务', { cause: error })
}

function isAbortLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return false
  }

  return error.name === 'TimeoutError' || error.name === 'AbortError'
}
