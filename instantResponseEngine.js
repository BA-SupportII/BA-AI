/**
 * Instant Response Engine - Returns fastest accurate response
 * Combines caching + smart model selection + streaming
 */

import { getCachedResponse, getSemanticCachedResponse, setCachedResponse, generateCacheKey } from './responseCache.js';
import { classifyIntent } from './intentClassifier.js';

export class InstantResponseEngine {
  constructor() {
    this.responseTimeMetrics = new Map();
    this.hitRates = { cache: 0, total: 0 };
  }

  /**
   * Get instant response - tries cache first, then optimized execution
   */
  async getInstantResponse(prompt, options = {}) {
    const startTime = Date.now();
    const isFastQuery = this.isFastQuery(prompt);
    const embedFn = options.embedFn;
    const semanticThreshold = Number.isFinite(options.semanticThreshold)
      ? options.semanticThreshold
      : 0.92;
    
    // Classify intent first (very fast)
    const classification = classifyIntent(prompt);
    const cacheKey = generateCacheKey(prompt, classification.intent);

    const skipCache = classification.intent === "RANKING_QUERY";
    // TRY CACHE FIRST (instant)
    const cachedResponse = skipCache ? null : getCachedResponse(cacheKey, isFastQuery);
    if (cachedResponse) {
      this.hitRates.cache++;
      this.hitRates.total++;
      const latency = Date.now() - startTime;
      console.log(`[CACHE HIT] ${latency}ms`);
      return {
        response: cachedResponse,
        source: 'cache',
        latency,
        accuracy: 'cached'
      };
    }

    this.hitRates.total++;

    // Semantic cache lookup (slower than exact but still fast)
    let embedding = null;
    if (embedFn) {
      try {
        embedding = await embedFn(prompt);
      } catch (err) {
        embedding = null;
      }
    }
    if (!skipCache && embedding && embedding.length > 0) {
      const semanticMatch = getSemanticCachedResponse({
        embedding,
        threshold: semanticThreshold,
        isFastQuery
      });
      if (semanticMatch) {
        const latency = Date.now() - startTime;
        return {
          response: semanticMatch.response,
          source: 'semantic_cache',
          latency,
          accuracy: 'cached',
          cacheKey,
          embedding
        };
      }
    }

    // OPTIMIZED EXECUTION PATH
    const selectedModel = this.selectOptimalModel(classification, isFastQuery);
    const systemPrompt = this.getSystemPrompt(classification.intent, isFastQuery);

    // Return response object with metadata for streaming
    return {
      prompt,
      intent: classification.intent,
      model: selectedModel,
      systemPrompt,
      isFastQuery,
      cacheKey,
      embedding,
      intent: classification.intent,
      source: 'execution',
      startTime,
      accuracy: 'fresh'
    };
  }

  /**
   * Detect if query is fast-path eligible
   */
  isFastQuery(prompt) {
    const fastPatterns = [
      /\b(grammar|correct|fix|spell|typo)\b/i,
      /\b(hi|hello|how are you|what's up|thanks)\b/i,
      /\b(remember|save|my [\w]+)\b/i,
      /^[?]*(who|what|where|when|why|how).{0,150}$/i
    ];
    
    return fastPatterns.some(p => p.test(prompt)) && prompt.length < 200;
  }

  /**
   * Select optimal model - balance speed & accuracy
   */
  selectOptimalModel(classification, isFastQuery) {
    // Fast queries always use Gemma 2B
    if (isFastQuery) {
      return 'gemma:2b';
    }

    // Use preferred model but with fallback
    const preferred = classification.modelPreference;
    
    // Map models to speed tiers
    const speedTier = {
      'gemma:2b': { speed: 3, accuracy: 6 },
      'mistral-small': { speed: 2, accuracy: 8 },
      'qwen3': { speed: 2, accuracy: 9 },
      'qwen3-coder': { speed: 2, accuracy: 9 },
      'deepseek-coder-v2': { speed: 2, accuracy: 8 },
      'llama3.2': { speed: 1, accuracy: 7 },
      'deepseek-r1': { speed: 2, accuracy: 9 }
    };

    // If high confidence & simple, use faster model
    if (classification.confidence === 'VERY_HIGH' && classification.score > 5) {
      return 'qwen3'; // Fast accurate
    }

    return preferred || 'mistral-small';
  }

  /**
   * Get optimized system prompt based on intent
   */
  getSystemPrompt(intent, isFastQuery) {
    if (isFastQuery) {
      return `Respond VERY BRIEFLY and INSTANTLY:
- Answer in 2-3 sentences max
- Direct, no fluff
- Format: Result only`;
    }

    const prompts = {
      GRAMMAR_CORRECTION: `Fix the text and explain briefly. Format:
Result
- Corrected text
- 1-2 brief notes`,
      
      SIMPLE_QA: `Answer concisely in 1-2 sentences. Format:
Result
- Direct answer`,
      
      MATH_REASONING: `Show brief work then answer. Format:
Thinking
- 2-3 calculation steps
Result
- Final answer`,
      
      CODE_TASK: `Provide working code. Format:
Result
- Code with minimal comments`,
      
      DEFAULT: `Respond clearly and concisely:
Thinking
- 3-5 bullets with approach
Result
- Complete answer`
    };

    return prompts[intent] || prompts.DEFAULT;
  }

  /**
   * Cache the final response
   */
  cacheResponse(cacheKey, response, options = {}) {
    setCachedResponse(cacheKey, response, options);
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    const cacheHitRate = this.hitRates.total > 0 
      ? (this.hitRates.cache / this.hitRates.total * 100).toFixed(1)
      : 0;

    return {
      totalQueries: this.hitRates.total,
      cacheHits: this.hitRates.cache,
      cacheHitRate: `${cacheHitRate}%`,
      avgLatency: this.calculateAvgLatency()
    };
  }

  /**
   * Calculate average response time
   */
  calculateAvgLatency() {
    if (this.responseTimeMetrics.size === 0) return 'N/A';
    
    const times = Array.from(this.responseTimeMetrics.values());
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return `${Math.round(avg)}ms`;
  }

  /**
   * Record response latency
   */
  recordLatency(cacheKey, latency) {
    this.responseTimeMetrics.set(cacheKey, latency);
    
    // Keep only last 100 measurements
    if (this.responseTimeMetrics.size > 100) {
      const firstKey = this.responseTimeMetrics.keys().next().value;
      this.responseTimeMetrics.delete(firstKey);
    }
  }

  /**
   * Clear metrics (for testing)
   */
  resetMetrics() {
    this.hitRates = { cache: 0, total: 0 };
    this.responseTimeMetrics.clear();
  }
}

export const instantResponseEngine = new InstantResponseEngine();
