/** 每个缩写默认返回的释义条数。 */
export const DEFAULT_LIMIT = 10

/** `limit` 参数上限。 */
export const MAX_LIMIT = 50

/** 单次查询允许的唯一缩写数。 */
export const MAX_WORDS = 100

/** 单个缩写允许的最大长度。 */
export const MAX_TERM_LENGTH = 64

/** `explain_text` 允许的最大文本长度。 */
export const MAX_TEXT_LENGTH = 10_000

/** 单次上游请求携带的缩写数。 */
export const BATCH_SIZE = 50

/** 单个缩写最多记录的文本位置数。 */
export const MAX_OCCURRENCES_PER_TERM = 100
