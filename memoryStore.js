import path from "path";
import { promises as fs } from "fs";

const MEMORY_DIR = path.join(process.cwd(), "data");
const MEMORY_PATH = path.join(MEMORY_DIR, "memory.json");
const MAX_ENTRIES = 500;
const MIN_SCORE = 2;
const DEFAULT_TTL_DAYS = 30;
const STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","by","for","from","has","have","how","i","if","in",
  "is","it","of","on","or","that","the","this","to","was","we","what","when","where","who",
  "why","will","with","you","your"
]);

function normalize(text) {
  return String(text || "").toLowerCase();
}

function tokenize(text) {
  const clean = normalize(text).replace(/[^a-z0-9\\s]/g, " ");
  return clean.split(/\\s+/).filter(Boolean);
}

function extractKeywords(text) {
  const words = tokenize(text);
  const filtered = words.filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return Array.from(new Set(filtered)).slice(0, 40);
}

function isExpired(entry) {
  if (!entry?.expiresAt) return false;
  const expiresAt = Date.parse(entry.expiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return Date.now() > expiresAt;
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

async function ensureMemoryFile() {
  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    await fs.access(MEMORY_PATH);
  } catch (err) {
    if (err.code === "ENOENT") {
      await fs.writeFile(MEMORY_PATH, JSON.stringify({ entries: [] }, null, 2), "utf8");
    } else {
      throw err;
    }
  }
}

export async function loadMemory() {
  await ensureMemoryFile();
  const raw = await fs.readFile(MEMORY_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

export async function saveMemory(entries) {
  await ensureMemoryFile();
  const trimmed = entries.slice(-MAX_ENTRIES);
  await fs.writeFile(MEMORY_PATH, JSON.stringify({ entries: trimmed }, null, 2), "utf8");
}

export function pruneExpiredEntries(entries) {
  return entries.filter((entry) => !isExpired(entry));
}

export function detectMemoryTrigger(prompt) {
  return /save to memory|remember this|save memory|remember it/i.test(String(prompt || ""));
}

function extractKeyPoints(text, limit = 4) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines.filter((line) => /^[-*•]\s+/.test(line) || /^\d+[\).]\s+/.test(line));
  const picks = (bullets.length > 0 ? bullets : lines).slice(0, limit);
  return picks.map((line) =>
    line.replace(/^[-*•]\s+/, "").replace(/^\d+[\).]\s+/, "").trim()
  );
}

export function summarizeResponse(response) {
  const points = extractKeyPoints(response);
  if (points.length === 0) return String(response || "").slice(0, 300);
  return points.join("; ").slice(0, 500);
}

export function buildMemoryEntry({ prompt, response, meta = {}, embedding = null, ttlDays = DEFAULT_TTL_DAYS }) {
  const expiresAt = ttlDays > 0 ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString() : null;
  const keywords = extractKeywords(`${prompt} ${response}`);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    prompt: String(prompt || "").slice(0, 4000),
    response: String(response || "").slice(0, 8000),
    keywords,
    embedding: Array.isArray(embedding) ? embedding : null,
    meta,
    createdAt: new Date().toISOString(),
    expiresAt
  };
}

export function scoreEntry(entry, queryTokens, options = {}) {
  const keywords = entry.keywords || [];
  const keywordSet = new Set(keywords);
  let score = 0;
  for (const token of queryTokens) {
    if (keywordSet.has(token)) score += 1;
  }
  if (options.embedding && Array.isArray(entry.embedding)) {
    const sim = cosineSimilarity(options.embedding, entry.embedding);
    score += sim * (options.embeddingWeight || 2);
  }
  return score;
}

function filterEntriesForUser(entries, userId, teamMode, teamId) {
  if (teamMode) {
    if (teamId) {
      return entries.filter((entry) => entry?.meta?.teamId === teamId);
    }
    return entries;
  }
  if (!userId) return entries;
  return entries.filter((entry) => entry?.meta?.userId === userId);
}

export function queryMemoryEntries(entries, query, limit = 4, options = {}) {
  const tokens = extractKeywords(query);
  if (tokens.length === 0) return [];
  const scoped = filterEntriesForUser(entries, options.userId, options.teamMode, options.teamId)
    .filter((entry) => !isExpired(entry));
  const scored = scoped
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens, options) }))
    .filter((item) => item.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((item) => item.entry);
}
