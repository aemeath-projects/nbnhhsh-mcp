import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_TERM_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_WORDS,
} from './constants.js'
import { ServiceInputError, type NbnhhshService } from './service.js'
import type { ExplainedTerm, TermResult } from './types.js'
import { UpstreamError } from './upstream.js'

const termResultSchema = z.object({
  word: z.string(),
  status: z.enum(['translated', 'no-translation', 'unknown']),
  translations: z.array(z.string()),
  candidates: z.array(z.string()),
  truncated: z.boolean(),
})

const guessInputSchema = z.object({
  words: z
    .array(z.string().min(1).max(MAX_TERM_LENGTH))
    .min(1)
    .max(MAX_WORDS)
    .describe('待查询的拼音首字母缩写，例如 ["yyds","xswl"]。'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe('每个缩写最多返回的释义条数。'),
})

const guessOutputSchema = z.object({
  results: z.array(termResultSchema),
})

const occurrenceSchema = z.object({
  start: z.number().int(),
  end: z.number().int(),
  raw: z.string(),
})

const explainInputSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_LENGTH).describe('包含网络缩写的文本。'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe('每个缩写最多返回的释义条数。'),
})

const explainedTermSchema = termResultSchema.extend({
  occurrences: z.array(occurrenceSchema),
  occurrencesTruncated: z.boolean(),
})

const explainOutputSchema = z.object({
  terms: z.array(explainedTermSchema),
})

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: true,
  idempotentHint: true,
} as const

export function registerGuessTool(server: McpServer, service: NbnhhshService): void {
  server.registerTool(
    'guess',
    {
      title: '查询网络缩写',
      description:
        '批量查询中文互联网拼音首字母缩写（如 yyds、xswl、bbl）的候选释义。释义来自社区词库，按相关度排序，需结合上下文判断。',
      inputSchema: guessInputSchema,
      outputSchema: guessOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ words, limit }) => {
      try {
        const results = await service.guess(words, limit)
        return {
          content: [{ type: 'text', text: formatResults(results) }],
          structuredContent: { results },
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )
}

export function registerExplainTextTool(server: McpServer, service: NbnhhshService): void {
  server.registerTool(
    'explain_text',
    {
      title: '解释文本中的网络缩写',
      description:
        '从任意文本中提取拼音首字母缩写并查询其候选释义，返回每个缩写的出现位置。适用于翻译或理解含有网络缩写的句子。',
      inputSchema: explainInputSchema,
      outputSchema: explainOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ text, limit }) => {
      try {
        const terms = await service.explainText(text, limit)
        return {
          content: [{ type: 'text', text: formatExplainedTerms(terms) }],
          structuredContent: { terms },
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )
}

function toolError(error: unknown): CallToolResult {
  if (error instanceof UpstreamError) {
    const status = error.status === undefined ? '' : ` (HTTP ${String(error.status)})`
    console.warn(`nbnhhsh 上游请求失败：${error.code}${status}`)
    return errorResult(describeUpstreamError(error))
  }

  if (error instanceof ServiceInputError) {
    return errorResult(error.message)
  }

  console.error('nbnhhsh 工具执行失败：', error)
  return errorResult('查询失败，请稍后重试。')
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] }
}

function describeUpstreamError(error: UpstreamError): string {
  switch (error.code) {
    case 'timeout':
      return 'nbnhhsh 上游查询超时，请稍后重试。'
    case 'network':
      return '无法连接 nbnhhsh 服务，请检查网络后重试。'
    case 'http':
      return `nbnhhsh 上游返回 HTTP ${String(error.status ?? '错误')}，请稍后重试。`
    case 'format':
      return 'nbnhhsh 上游返回了无法解析的数据，请稍后重试。'
    case 'unknown':
      return '查询失败，请稍后重试。'
  }
}

function formatResults(results: TermResult[]): string {
  return results.map(formatTerm).join('\n')
}

function formatExplainedTerms(terms: ExplainedTerm[]): string {
  if (terms.length === 0) {
    return '文本中没有找到可查询的缩写。'
  }
  return terms.map(formatExplainedTerm).join('\n')
}

function formatTerm(result: TermResult): string {
  switch (result.status) {
    case 'translated':
      return `${result.word}：${result.translations.join('、')}${result.truncated ? '……（已截断）' : ''}`
    case 'no-translation':
      return `${result.word}：已收录，暂无释义`
    case 'unknown':
      return result.candidates.length > 0
        ? `${result.word}：未收录，有可能是：${result.candidates.join('、')}`
        : `${result.word}：未收录`
  }
}

function formatExplainedTerm(term: ExplainedTerm): string {
  const base = formatTerm(term)
  if (term.occurrences.length === 0) {
    return base
  }

  const positions = term.occurrences
    .map((occurrence) => `${String(occurrence.start)}-${String(occurrence.end)}`)
    .join('、')
  const overflow = term.occurrencesTruncated ? '，位置已截断' : ''

  return `${base}（出现 ${String(term.occurrences.length)} 次，位置 ${positions}${overflow}）`
}
