import { MAX_OCCURRENCES_PER_TERM, MAX_TERM_LENGTH } from './constants.js'
import type { Occurrence } from './types.js'

export interface Extraction {
  /** 按首次出现顺序排列的唯一缩写。 */
  terms: string[]
  occurrences: Map<string, Occurrence[]>
  /** 出现次数超过记录上限的缩写。 */
  truncatedTerms: Set<string>
}

/**
 * 按上游规则提取长度至少为 2 的连续字母/数字片段。
 *
 * 正则每次调用新建，避免 `lastIndex` 状态在多次调用间泄漏；位置下标基于
 * JavaScript 的 UTF-16 字符串。
 */
export function extractAbbreviations(text: string): Extraction {
  const terms: string[] = []
  const occurrences = new Map<string, Occurrence[]>()
  const truncatedTerms = new Set<string>()

  for (const match of text.matchAll(/[a-z0-9]{2,}/gi)) {
    const raw = match[0]
    if (raw.length > MAX_TERM_LENGTH) {
      continue
    }

    const word = raw.toLowerCase()
    const start = match.index

    let positions = occurrences.get(word)
    if (positions === undefined) {
      positions = []
      occurrences.set(word, positions)
      terms.push(word)
    }

    if (positions.length >= MAX_OCCURRENCES_PER_TERM) {
      truncatedTerms.add(word)
      continue
    }

    positions.push({ start, end: start + raw.length, raw })
  }

  return { terms, occurrences, truncatedTerms }
}
