/**
 * Response Cache - Store and retrieve cached responses
 * Reduces latency for repeated questions
 */

import { promises as fs } from "fs";
import path from "path";

const cache = new Map();
const MAX_CACHE_SIZE = 500;
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours (more fresh data)
const FAST_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days for simple Q&A
const CACHE_DIR = path.join(process.cwd(), "data");
const CACHE_PATH = path.join(CACHE_DIR, "response_cache.json");
let cacheLoaded = false;
let saveTimer = null;

async function ensureCacheLoaded() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    for (const item of items) {
      if (!item || !item.key || !item.response || !item.timestamp) continue;
      cache.set(item.key, {
        response: item.response,
        timestamp: item.timestamp,
        embedding: Array.isArray(item.embedding) ? item.embedding : null,
        intent: item.intent || ""
      });
    }
  } catch (err) {
    // Ignore missing or invalid cache.
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      const items = Array.from(cache.entries()).map(([key, value]) => ({
        key,
        response: value.response,
        timestamp: value.timestamp,
        embedding: value.embedding || null,
        intent: value.intent || ""
      }));
      await fs.writeFile(CACHE_PATH, JSON.stringify({ items }, null, 2), "utf8");
    } catch (err) {
      // Ignore write errors.
    }
  }, 250);
}

/**
 * Generate cache key from prompt and intent
 */
export function generateCacheKey(prompt, intent) {
  // Normalize prompt (lowercase, trim)
  const normalized = prompt.toLowerCase().trim();
  // Create simple hash
  const hash = hashString(normalized);
  return `${intent}_${hash}`;
}

/**
 * Simple string hash function
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Get cached response
 */
export function getCachedResponse(cacheKey, isFastQuery = false) {
  if (!cacheLoaded) {
    // Fire and forget load; cache misses during load are acceptable.
    ensureCacheLoaded();
  }
  const entry = cache.get(cacheKey);
  
  if (!entry) return null;
  
  // Check if expired (use longer TTL for fast queries)
  const ttl = isFastQuery ? FAST_CACHE_TTL : CACHE_TTL;
  if (Date.now() - entry.timestamp > ttl) {
    cache.delete(cacheKey);
    return null;
  }
  
  // Mark cache hit for analytics
  entry.hits = (entry.hits || 0) + 1;
  entry.lastHit = Date.now();
  
  return entry.response;
}

/**
 * Save response to cache
 */
export function setCachedResponse(cacheKey, response, options = {}) {
  if (!cacheLoaded) {
    ensureCacheLoaded();
  }
  // Evict oldest entry if cache full
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  
  cache.set(cacheKey, {
    response,
    timestamp: Date.now(),
    embedding: Array.isArray(options.embedding) ? options.embedding : null,
    intent: options.intent || ""
  });
  scheduleSave();
}

/**
 * Find semantic cache match using embedding similarity
 */
export function getSemanticCachedResponse({
  embedding,
  threshold = 0.92,
  isFastQuery = false
}) {
  if (!cacheLoaded) {
    ensureCacheLoaded();
  }
  if (!Array.isArray(embedding)) return null;
  const ttl = isFastQuery ? FAST_CACHE_TTL : CACHE_TTL;
  let best = null;
  for (const entry of cache.values()) {
    if (!entry.embedding) continue;
    if (Date.now() - entry.timestamp > ttl) continue;
    const score = cosineSimilarity(embedding, entry.embedding);
    if (score >= threshold && (!best || score > best.score)) {
      best = { response: entry.response, score };
    }
  }
  return best;
}

/**
 * Clear all cache
 */
export function clearCache() {
  cache.clear();
  scheduleSave();
}

/**
 * Get cache stats
 */
export function getCacheStats() {
  return {
    size: cache.size,
    maxSize: MAX_CACHE_SIZE,
    ttlHours: CACHE_TTL / (1000 * 60 * 60)
  };
}
