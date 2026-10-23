interface CacheEntry<V> {
  value: V
  expiresAt: number
}

/**
 * TTL + LRU 缓存。
 *
 * 使用 `Map` 的插入顺序维护 LRU：命中时删除后重新插入；容量满时淘汰最旧项。
 * 过期采用惰性检查，不创建定时器，避免 Worker isolate 生命周期问题。
 */
export class TtlLruCache<V> {
  private readonly _ttlMs: number
  private readonly _maxEntries: number
  private readonly _entries = new Map<string, CacheEntry<V>>()

  constructor(ttlMs: number, maxEntries: number) {
    this._ttlMs = ttlMs
    this._maxEntries = maxEntries
  }

  get(key: string): V | undefined {
    if (!this._isEnabled()) {
      return undefined
    }

    const entry = this._entries.get(key)
    if (entry === undefined) {
      return undefined
    }

    if (entry.expiresAt <= Date.now()) {
      this._entries.delete(key)
      return undefined
    }

    this._entries.delete(key)
    this._entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: V): void {
    if (!this._isEnabled()) {
      return
    }

    this._entries.delete(key)
    if (this._entries.size >= this._maxEntries) {
      const oldest = this._entries.keys().next()
      if (!oldest.done) {
        this._entries.delete(oldest.value)
      }
    }

    this._entries.set(key, { value, expiresAt: Date.now() + this._ttlMs })
  }

  private _isEnabled(): boolean {
    return this._ttlMs > 0 && this._maxEntries > 0
  }
}
