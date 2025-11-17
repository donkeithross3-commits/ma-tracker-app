/**
 * Global cache for staging page data
 * Persists across component unmounts/remounts
 * 30 second TTL for all cached data
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 30000; // 30 seconds

class StagingDataCache {
  private cache: Map<string, CacheEntry<any>> = new Map();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if cache is still fresh
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      console.log(`[CACHE EXPIRED] ${key}`);
      this.cache.delete(key);
      return null;
    }

    console.log(`[CACHE HIT] ${key}`);
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    console.log(`[CACHE SET] ${key}`);
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check if cache is still fresh
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  clear(): void {
    console.log('[CACHE CLEAR] All data cleared');
    this.cache.clear();
  }

  invalidate(key: string): void {
    console.log(`[CACHE INVALIDATE] ${key}`);
    this.cache.delete(key);
  }

  // Get cache stats for debugging
  getStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    const fresh = entries.filter(([_, entry]) => now - entry.timestamp < CACHE_TTL);
    const stale = entries.filter(([_, entry]) => now - entry.timestamp >= CACHE_TTL);

    return {
      total: this.cache.size,
      fresh: fresh.length,
      stale: stale.length,
      entries: entries.map(([key, entry]) => ({
        key,
        age: Math.round((now - entry.timestamp) / 1000),
        fresh: now - entry.timestamp < CACHE_TTL
      }))
    };
  }
}

// Singleton instance - persists across component mounts
export const stagingCache = new StagingDataCache();

// Cache keys for different data types
export const CacheKeys = {
  EDGAR_DEALS: (status: string) => `edgar_deals_${status}`,
  INTELLIGENCE_DEALS: (tier: string) => `intelligence_deals_${tier}`,
  FILINGS: (filters: any) => `filings_${JSON.stringify(filters)}`,
  HALTS: 'halts',
  INTELLIGENCE_SOURCES: 'intelligence_sources',
  WATCH_LIST: 'watch_list',
  MONITORING_STATUS: 'monitoring_status'
};
