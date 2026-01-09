import path from "path";
import { promises as fs } from "fs";
import { extractTextFromFile } from "./documentIngest.js";

const INDEX_PATH = path.join(process.cwd(), "data", "doc_index.json");
const MAX_DOC_CHARS = 60000;
const AUTO_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".pdf",
  ".docx"
]);

function normalize(text) {
  return String(text || "").toLowerCase();
}

function extractKeywords(text) {
  const clean = normalize(text).replace(/[^a-z0-9\s]/g, " ");
  const words = clean.split(/\s+/).filter(Boolean);
  const filtered = words.filter((word) => word.length >= 3);
  return Array.from(new Set(filtered)).slice(0, 60);
}

async function collectFiles(dir, results) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await collectFiles(path.join(dir, entry.name), results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (AUTO_EXTENSIONS.has(ext)) {
        results.push(path.join(dir, entry.name));
      }
    }
  }
}

export async function buildDocIndex({ projectRoot, folder = "docs" }) {
  const targetDir = path.resolve(projectRoot, folder);
  const files = [];
  await collectFiles(targetDir, files);
  const entries = [];

  for (const filePath of files) {
    const text = await extractTextFromFile(filePath);
    const snippet = text.slice(0, MAX_DOC_CHARS);
    entries.push({
      path: path.relative(projectRoot, filePath),
      keywords: extractKeywords(snippet),
      snippet
    });
  }

  await fs.mkdir(path.dirname(INDEX_PATH), { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify({ entries }, null, 2), "utf8");
  return { count: entries.length, folder };
}

export async function queryDocIndex({ projectRoot, query, limit = 2 }) {
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    const data = JSON.parse(raw);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const tokens = extractKeywords(query);
    const scored = entries
      .map((entry) => ({
        entry,
        score: tokens.filter((token) => entry.keywords.includes(token)).length
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => ({ ...item.entry, score: item.score }));
    return scored;
  } catch (err) {
    return [];
  }
}
