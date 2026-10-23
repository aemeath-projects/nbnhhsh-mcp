import { parseList } from './env.js'
import { createFetchHandler, type FetchHandler } from './http.js'
import { resolveNbnhhshConfig } from './nbnhhsh/config.js'

export interface Env {
  ALLOWED_HOSTS?: string
  ALLOWED_ORIGINS?: string
  NBNHHSH_API_BASE?: string
  NBNHHSH_TIMEOUT_MS?: string
  NBNHHSH_CACHE_TTL_MS?: string
  NBNHHSH_CACHE_MAX_ENTRIES?: string
}

export function createWorkerHandler(env: Env): FetchHandler {
  return createFetchHandler({
    allowedHosts: parseList(env.ALLOWED_HOSTS),
    allowedOrigins: parseList(env.ALLOWED_ORIGINS),
    nbnhhsh: resolveNbnhhshConfig(env),
  })
}

let cachedHandler: FetchHandler | undefined

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    cachedHandler ??= createWorkerHandler(env)
    return cachedHandler.fetch(request)
  },
}
