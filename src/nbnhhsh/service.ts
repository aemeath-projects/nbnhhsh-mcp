import { TtlLruCache } from './cache.js'
import type { NbnhhshConfig } from './config.js'
import { BATCH_SIZE, DEFAULT_LIMIT, MAX_LIMIT, MAX_TERM_LENGTH, MAX_WORDS } from './constants.js'
import { extractAbbreviations } from './extract.js'
import type { ExplainedTerm, TermLookup, TermResult } from './types.js'
import { fetchUpstream, type UpstreamItem } from './upstream.js'

/** 服务层可预期的输入错误，工具层直接透传其文案。 */
export class ServiceInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceInputError'
  }
}

/**
 * nbnhhsh 查询服务。
 *
 * 实例持有缓存，必须在 `createFetchHandler` / `cli.ts` 中创建一次并复用，
 * 不要放进每次请求都会执行的 Server 工厂内部。
 */
export class NbnhhshService {
  private readonly _config: NbnhhshConfig
  private readonly _cache: TtlLruCache<TermLookup>
  private readonly _fetchImpl: typeof fetch

  constructor(config: NbnhhshConfig, fetchImpl: typeof fetch = globalThis.fetch) {
    this._config = config
    this._cache = new TtlLruCache<TermLookup>(config.cacheTtlMs, config.cacheMaxEntries)
    this._fetchImpl = fetchImpl
  }

  /** 批量查询缩写，结果顺序与去重后的输入顺序一致。 */
  async guess(words: string[], limit: number = DEFAULT_LIMIT): Promise<TermResult[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new ServiceInputError(`limit 必须是 1-${String(MAX_LIMIT)} 之间的整数。`)
    }

    const unique = normalizeWords(words)
    if (unique.length === 0) {
      throw new ServiceInputError('没有可查询的缩写。')
    }
    if (unique.length > MAX_WORDS) {
      throw new ServiceInputError(`缩写数量超过上限 ${String(MAX_WORDS)}。`)
    }

    const lookups = new Map<string, TermLookup>()
    const misses: string[] = []

    for (const word of unique) {
      const cached = this._cache.get(word)
      if (cached === undefined) {
        misses.push(word)
      } else {
        lookups.set(word, cached)
      }
    }

    if (misses.length > 0) {
      const fetched = await this._fetchMany(misses)
      for (const [word, lookup] of fetched) {
        this._cache.set(word, lookup)
        lookups.set(word, lookup)
      }
    }

    return unique.map((word) => {
      const lookup = lookups.get(word)
      if (lookup === undefined) {
        throw new Error('内部错误：查询结果缺失。')
      }
      return toTermResult(lookup, limit)
    })
  }

  /** 从文本中提取缩写并查询，保留每个缩写的出现位置。 */
  async explainText(text: string, limit: number = DEFAULT_LIMIT): Promise<ExplainedTerm[]> {
    const extraction = extractAbbreviations(text)
    if (extraction.terms.length > MAX_WORDS) {
      throw new ServiceInputError(
        `文本中包含 ${String(extraction.terms.length)} 个唯一缩写，超过上限 ${String(MAX_WORDS)}，请缩小文本范围。`,
      )
    }
    if (extraction.terms.length === 0) {
      return []
    }

    const results = await this.guess(extraction.terms, limit)
    return results.map((result) => ({
      ...result,
      occurrences: extraction.occurrences.get(result.word) ?? [],
      occurrencesTruncated: extraction.truncatedTerms.has(result.word),
    }))
  }

  private async _fetchMany(words: string[]): Promise<Map<string, TermLookup>> {
    const batches = chunk(words, BATCH_SIZE)
    const responses = await Promise.all(
      batches.map((batch) => fetchUpstream(batch, this._config, this._fetchImpl)),
    )

    const index = new Map<string, UpstreamItem>()
    for (const items of responses) {
      for (const item of items) {
        const key = item.name.trim().toLowerCase()
        if (key.length > 0 && !index.has(key)) {
          index.set(key, item)
        }
      }
    }

    const lookups = new Map<string, TermLookup>()
    for (const word of words) {
      const item = index.get(word)
      lookups.set(word, item === undefined ? unknownLookup(word) : toLookup(word, item))
    }
    return lookups
  }
}

function normalizeWords(words: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const word of words) {
    const trimmed = word.trim().toLowerCase()
    if (trimmed.length === 0 || trimmed.length > MAX_TERM_LENGTH || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    normalized.push(trimmed)
  }

  return normalized
}

function normalizeStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    normalized.push(trimmed)
  }

  return normalized
}

function toLookup(word: string, item: UpstreamItem): TermLookup {
  const translations = normalizeStrings(item.trans ?? [])
  if (translations.length > 0) {
    return { word, status: 'translated', translations, candidates: [] }
  }

  // 存在 trans 字段但为空（null 或 []）表示“已收录、暂无释义”，
  // 与完全没有该字段的“未收录”必须区分。
  if (Object.hasOwn(item, 'trans')) {
    return { word, status: 'no-translation', translations: [], candidates: [] }
  }

  return {
    word,
    status: 'unknown',
    translations: [],
    candidates: normalizeStrings(item.inputting ?? []),
  }
}

function unknownLookup(word: string): TermLookup {
  return { word, status: 'unknown', translations: [], candidates: [] }
}

function toTermResult(lookup: TermLookup, limit: number): TermResult {
  const translations = lookup.translations.slice(0, limit)
  const candidates = lookup.candidates.slice(0, limit)

  return {
    word: lookup.word,
    status: lookup.status,
    translations,
    candidates,
    truncated:
      translations.length < lookup.translations.length ||
      candidates.length < lookup.candidates.length,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}
