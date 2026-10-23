/** 缩写在上游词库中的状态。 */
export type LookupStatus = 'translated' | 'no-translation' | 'unknown'

/** 单个缩写的查询结果（未应用 limit）。 */
export interface TermLookup {
  word: string
  status: LookupStatus
  translations: string[]
  candidates: string[]
}

/** 缩写在文本中的一次出现。`end` 不含，下标基于 UTF-16。 */
export interface Occurrence {
  start: number
  end: number
  raw: string
}

/** 返回给调用方的缩写结果（已应用 limit）。 */
export interface TermResult extends TermLookup {
  truncated: boolean
}

/** `explain_text` 返回的缩写结果，附带出现位置。 */
export interface ExplainedTerm extends TermResult {
  occurrences: Occurrence[]
  occurrencesTruncated: boolean
}
