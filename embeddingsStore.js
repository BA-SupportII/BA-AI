import path from "path";
import crypto from "crypto";
import { promises as fs } from "fs";
import { extractTextFromFile } from "./documentIngest.js";

const STORE_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "embeddings.json");
const MAX_CHUNKS_PER_FILE = 120;
const MAX_TEXT_LENGTH = 150000;
const SUPPORTED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".html",
  ".css"
]);

function hashText(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function chunkText(text, chunkSize, overlap) {
  const chunks = [];
  const safeText = String(text || "");
  if (!safeText) return chunks;
  let start = 0;
  while (start < safeText.length && chunks.length < MAX_CHUNKS_PER_FILE) {
    const end = Math.min(start + chunkSize, safeText.length);
    const chunk = safeText.slice(start, end);
    chunks.push(chunk);
    if (end === safeText.length) break;
    start = Math.max(end - overlap, 0);
  }
  return chunks;
}

async function ensureStore() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch (err) {
    if (err.code === "ENOENT") {
      await fs.writeFile(STORE_PATH, JSON.stringify({ items: [] }, null, 2), "utf8");
    } else {
      throw err;
    }
  }
}

async function loadStore() {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

async function saveStore(items) {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify({ items }, null, 2), "utf8");
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

async function collectFiles(root, folder, results) {
  const target = folder ? path.resolve(root, folder) : root;
  const entries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      await collectFiles(root, path.join(folder || "", entry.name), results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }
}

export async function buildEmbeddingsIndex({
  projectRoot,
  filePaths,
  folder,
  embedFn,
  chunkSize = 900,
  chunkOverlap = 160
}) {
  const items = await loadStore();
  const files = [];

  if (Array.isArray(filePaths) && filePaths.length > 0) {
    for (const filePath of filePaths) {
      const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
      files.push(resolved);
    }
  } else {
    await collectFiles(projectRoot, folder || "", files);
  }

  const indexed = [];
  for (const filePath of files) {
    const relative = path.relative(projectRoot, filePath);
    try {
      const rawText = await extractTextFromFile(filePath);
      const text = rawText.slice(0, MAX_TEXT_LENGTH);
      const chunks = chunkText(text, chunkSize, chunkOverlap);
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        const hash = hashText(`${relative}:${i}:${chunk}`);
        if (items.find((item) => item.id === hash)) continue;
        const embedding = await embedFn(chunk);
        if (!embedding || embedding.length === 0) continue;
        items.push({
          id: hash,
          source: relative,
          chunkIndex: i,
          text: chunk,
          embedding
        });
        indexed.push({ source: relative, chunkIndex: i });
      }
    } catch (err) {
      indexed.push({ source: relative, error: err.message });
    }
  }

  await saveStore(items);
  return { indexed, total: items.length };
}

export async function queryEmbeddings({
  query,
  embedFn,
  limit = 3
}) {
  const items = await loadStore();
  if (!query || items.length === 0) return [];
  const queryEmbedding = await embedFn(query);
  if (!queryEmbedding || queryEmbedding.length === 0) return [];
  const scored = items
    .map((item) => ({
      item,
      score: cosineSimilarity(queryEmbedding, item.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((result) => ({
    source: result.item.source,
    chunkIndex: result.item.chunkIndex,
    score: result.score,
    text: result.item.text
  }));
}
