export interface NbnhhshConfig {
  /** 上游 API 根地址，不含末尾斜杠。 */
  apiBase: string
  /** 单次上游请求超时（毫秒）。 */
  timeoutMs: number
  /** 缓存有效期（毫秒），0 表示禁用缓存。 */
  cacheTtlMs: number
  /** 缓存容量上限。 */
  cacheMaxEntries: number
}

/** Node 的 `process.env` 与 Worker 的 `Env` 都满足该结构。 */
export interface NbnhhshEnv {
  NBNHHSH_API_BASE?: string
  NBNHHSH_TIMEOUT_MS?: string
  NBNHHSH_CACHE_TTL_MS?: string
  NBNHHSH_CACHE_MAX_ENTRIES?: string
}

export const DEFAULT_NBNHHSH_CONFIG: NbnhhshConfig = {
  apiBase: 'https://lab.magiconch.com/api/nbnhhsh',
  timeoutMs: 8000,
  cacheTtlMs: 600_000,
  cacheMaxEntries: 1000,
}

/**
 * 解析 nbnhhsh 配置。空值使用默认值；非法值告警后回退或夹取到合法范围，
 * 避免 Worker 因单个错误环境变量在首个请求上直接失败。
 */
export function resolveNbnhhshConfig(env: NbnhhshEnv = {}): NbnhhshConfig {
  return {
    apiBase: resolveApiBase(env.NBNHHSH_API_BASE),
    timeoutMs: resolveInteger(
      env.NBNHHSH_TIMEOUT_MS,
      DEFAULT_NBNHHSH_CONFIG.timeoutMs,
      1000,
      30_000,
      'NBNHHSH_TIMEOUT_MS',
    ),
    cacheTtlMs: resolveInteger(
      env.NBNHHSH_CACHE_TTL_MS,
      DEFAULT_NBNHHSH_CONFIG.cacheTtlMs,
      0,
      86_400_000,
      'NBNHHSH_CACHE_TTL_MS',
    ),
    cacheMaxEntries: resolveInteger(
      env.NBNHHSH_CACHE_MAX_ENTRIES,
      DEFAULT_NBNHHSH_CONFIG.cacheMaxEntries,
      1,
      10_000,
      'NBNHHSH_CACHE_MAX_ENTRIES',
    ),
  }
}

function resolveApiBase(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_NBNHHSH_CONFIG.apiBase
  }

  const candidate = value.trim().replace(/\/+$/, '')
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('仅支持 http/https')
    }
    return candidate
  } catch {
    console.warn(`无效的 NBNHHSH_API_BASE "${value}"，已回退为默认值。`)
    return DEFAULT_NBNHHSH_CONFIG.apiBase
  }
}

function resolveInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    console.warn(`无效的 ${name} "${value}"，已回退为默认值 ${String(fallback)}。`)
    return fallback
  }

  if (parsed < min || parsed > max) {
    const clamped = Math.min(Math.max(parsed, min), max)
    console.warn(`越界的 ${name} "${value}"，已夹取为 ${String(clamped)}。`)
    return clamped
  }

  return parsed
}
