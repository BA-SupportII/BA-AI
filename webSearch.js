// Web search integration using SerpAPI (requires API key)
// Alternative: Use DuckDuckGo API (no key required)

const SEARCH_API = process.env.SEARCH_API || "duckduckgo"; // "duckduckgo" | "serpapi" | "searxng"
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";
const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8080";
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_CACHE_TTL_MS = 30 * 60 * 1000;
const searchCache = new Map();
const fetchCache = new Map();

function getCached(map, key, ttlMs) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(map, key, value) {
  map.set(key, { value, timestamp: Date.now() });
}

export async function searchWeb(query, maxResults = 5) {
  try {
    const cacheKey = `${SEARCH_API}:${query}:${maxResults}`;
    const cached = getCached(searchCache, cacheKey, SEARCH_CACHE_TTL_MS);
    if (cached) return cached;

    if (SEARCH_API === "serpapi" && !SEARCH_API_KEY) {
      console.warn("SerpAPI key not set. Using DuckDuckGo instead.");
      const results = await searchDuckDuckGo(query, maxResults);
      setCached(searchCache, cacheKey, results);
      return results;
    }

    if (SEARCH_API === "serpapi") {
      const results = await searchSerpAPI(query, maxResults);
      setCached(searchCache, cacheKey, results);
      return results;
    }

    if (SEARCH_API === "searxng") {
      try {
        const results = await searchSearxng(query, maxResults);
        if (results.length > 0) {
          setCached(searchCache, cacheKey, results);
          return results;
        }
        console.warn("Searxng returned no results. Falling back to DuckDuckGo.");
      } catch (err) {
        console.warn("Searxng failed. Falling back to DuckDuckGo.");
      }
      const results = await searchDuckDuckGo(query, maxResults);
      setCached(searchCache, cacheKey, results);
      return results;
    }

    const results = await searchDuckDuckGo(query, maxResults);
    setCached(searchCache, cacheKey, results);
    return results;
  } catch (err) {
    console.error("Web search error:", err);
    return [];
  }
}

async function searchDuckDuckGo(query, maxResults = 5) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&max_results=${maxResults}`
    );

    if (!response.ok) {
      throw new Error(`DuckDuckGo API error: ${response.status}`);
    }

    const data = await response.json();
    const results = [];

    // Process AbstractResult
    if (data.AbstractText) {
      results.push({
        title: data.AbstractHeading || "Summary",
        snippet: data.AbstractText,
        link: data.AbstractURL || "",
        source: "DuckDuckGo"
      });
    }

    // Process RelatedTopics
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.slice(0, maxResults - 1).forEach((topic) => {
        if (topic.Text) {
          results.push({
            title: topic.FirstURL?.split("/")[2] || "Related",
            snippet: topic.Text,
            link: topic.FirstURL || "",
            source: "DuckDuckGo"
          });
        }
      });
    }

    return results.slice(0, maxResults);
  } catch (err) {
    console.error("DuckDuckGo search error:", err);
    return [];
  }
}

async function searchSearxng(query, maxResults = 5) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const baseUrl = SEARXNG_URL.replace(/\/+$/, "");
    const response = await fetch(
      `${baseUrl}/search?q=${encodedQuery}&format=json&language=en&safesearch=0`
    );

    if (!response.ok) {
      throw new Error(`SearXNG error: ${response.status}`);
    }

    const data = await response.json();
    const results = [];

    if (data.results && Array.isArray(data.results)) {
      data.results.slice(0, maxResults).forEach((result) => {
        results.push({
          title: result.title || "",
          snippet: result.content || "",
          link: result.url || "",
          source: result.engine || "SearXNG"
        });
      });
    }

    return results;
  } catch (err) {
    console.error("SearXNG search error:", err);
    return [];
  }
}

async function searchSerpAPI(query, maxResults = 5) {
  try {
    const params = new URLSearchParams({
      q: query,
      api_key: SEARCH_API_KEY,
      num: maxResults,
      engine: "google"
    });

    const response = await fetch(
      `https://serpapi.com/search?${params}`
    );

    if (!response.ok) {
      throw new Error(`SerpAPI error: ${response.status}`);
    }

    const data = await response.json();
    const results = [];

    // Process organic results
    if (data.organic_results && Array.isArray(data.organic_results)) {
      data.organic_results.slice(0, maxResults).forEach((result) => {
        results.push({
          title: result.title || "",
          snippet: result.snippet || "",
          link: result.link || "",
          source: new URL(result.link || "").hostname || "Unknown"
        });
      });
    }

    return results;
  } catch (err) {
    console.error("SerpAPI search error:", err);
    return [];
  }
}

export function extractRelevantInfo(searchResults, query) {
  if (!searchResults || searchResults.length === 0) {
    return "No web results found.";
  }

  let info = "Search Results (with citations):\n";
  searchResults.forEach((result, idx) => {
    const num = idx + 1;
    const title = result.title || "Result";
    const link = result.link || "";
    info += `\n[${num}] ${title}\n`;
    if (result.snippet) {
      info += `   ${result.snippet}\n`;
    }
    if (link) {
      info += `   URL: ${link}\n`;
    }
    if (result.source) {
      info += `   Source: ${result.source}\n`;
    }
  });

  return info;
}

export async function fetchPageContent(url) {
  try {
    const cached = getCached(fetchCache, url, FETCH_CACHE_TTL_MS);
    if (cached) return cached;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "BA-AI-Studio/1.0 (+http://localhost:4000)"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    // Simple text extraction (remove scripts, styles, etc.)
    const text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const trimmed = text.slice(0, 3000);
    setCached(fetchCache, url, trimmed);
    return trimmed; // Limit to 3000 chars
  } catch (err) {
    console.error(`Failed to fetch content from ${url}:`, err);
    return null;
  }
}
