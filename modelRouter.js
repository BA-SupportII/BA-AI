import path from "path";
import { promises as fs } from "fs";
import { extractTextFromFile } from "./documentIngest.js";

const DEBUG_PATTERNS = [
  /\b(error|exception|traceback|stack trace|bug|debug|crash|failed|fix)\b/i
];

const SQL_PATTERNS = [
  /\b(sql|query|select|insert|update|delete|table|schema|index|join|where)\b/i
];

const CODE_PATTERNS = [
  /```/,
  /\b(python|golang|go\b|javascript|typescript|node\.?js|html|css|react|express|api)\b/i
];

const CHART_PATTERNS = [
  /\bchart\b/i,
  /\bplot\b/i,
  /\bgraph\b/i,
  /\bbar\b/i,
  /\bline\b/i,
  /\bpie\b/i,
  /\bscatter\b/i,
  /\bsvg\b/i,
  /\baxis\b/i,
  /\bwin\/loss\b/i,
  /\boutcome\b/i,
  /\brevenue\b/i,
  /\bprofit margin\b/i,
  /\bloss margin\b/i,
  /\boverrun\b/i,
  /\bunderbudget\b/i
];

const IMAGE_PROMPT_PATTERNS = [
  /\bimage prompt\b/i,
  /\bsd[xl]?\b/i,
  /\bstable diffusion\b/i,
  /\bcomfyui\b/i
];

const VIDEO_PROMPT_PATTERNS = [
  /\bvideo prompt\b/i,
  /\bstoryboard\b/i,
  /\banimation\b/i
];

const RESEARCH_PATTERNS = [
  /\bresearch\b/i,
  /\bcitations?\b/i,
  /\bsources?\b/i,
  /\bnews\b/i,
  /\blatest\b/i,
  /\btoday\b/i,
  /\bcurrent\b/i,
  /\bupdate\b/i,
  /\bhappening\b/i,
  /\bworld\b/i
];

const REPORT_PATTERNS = [
  /\breport\b/i,
  /\bexecutive summary\b/i,
  /\binsights\b/i
];

const GRAMMAR_PATTERNS = [
  /\b(grammar|correct|fix|spell|typo|punctuation)\b/i,
  /\b(is (this|that|it) (correct|right|proper)|should (it|this) be|does (this|that) look good)\b/i,
  /\b(rephrase|reword|improve|better way|better phrasing)\b/i
];

const CONVERSATION_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|how are you|what's up|you ok|you good).*$/i,
  /\b(how is|what's new|everything ok|everything good)\b/i,
  /\b(my (name|project|preference|favorite)|i (like|prefer|am|think|believe|know))\b/i
];

const PERSONAL_PATTERNS = [
  /\b(remember|save|store|recall|remind|memory|note|bookmark)\b/i,
  /\b(my [\w]+|i am|call me|name is|my name|favorite|preference)\b/i,
  /\b(about me|my details|my info|personal|profile|settings)\b/i
];

const DASHBOARD_PATTERNS = [
  /\bdashboard\b/i,
  /\bkpi\b/i,
  /\bscorecard\b/i,
  /\badmin panel\b/i,
  /\banalytics\b/i
];

const MAX_FILE_CHARS = 120000;
const MAX_FILE_SIZE_BYTES = 250 * 1024;
const AUTO_FILE_LIMIT = 4;
const AUTO_SCAN_LIMIT = 120;
const AUTO_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
  ".md",
  ".html",
  ".css"
]);
const AUTO_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "data"
]);

function matchesAny(prompt, patterns) {
  if (!prompt) return false;
  return patterns.some((pattern) => pattern.test(prompt));
}

function normalize(text) {
  return String(text || "").toLowerCase();
}

function extractKeywords(text) {
  const clean = normalize(text).replace(/[^a-z0-9\s]/g, " ");
  const words = clean.split(/\s+/).filter(Boolean);
  const filtered = words.filter((word) => word.length >= 3);
  return Array.from(new Set(filtered)).slice(0, 50);
}

async function collectProjectFiles(dir, results) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (AUTO_SKIP_DIRS.has(entry.name)) continue;
      await collectProjectFiles(path.join(dir, entry.name), results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (AUTO_EXTENSIONS.has(ext)) {
        results.push(path.join(dir, entry.name));
      }
    }
  }
}

async function scoreFile(filePath, keywords) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) return 0;
    const content = await fs.readFile(filePath, "utf8");
    const lower = normalize(content.slice(0, MAX_FILE_CHARS));
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) score += 1;
    }
    return score;
  } catch (err) {
    return 0;
  }
}

export async function autoSelectFiles({ projectRoot, prompt, maxFiles = AUTO_FILE_LIMIT }) {
  if (!prompt) return [];
  const keywords = extractKeywords(prompt);
  if (keywords.length === 0) return [];
  const files = [];
  await collectProjectFiles(projectRoot, files);
  const scored = [];
  const scanList = files.slice(0, AUTO_SCAN_LIMIT);
  for (const filePath of scanList) {
    const score = await scoreFile(filePath, keywords);
    if (score > 0) scored.push({ filePath, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxFiles).map((item) => item.filePath);
}

export function chooseRoute({ prompt, imageDescription, taskHint, preferFast }) {
  if (taskHint) {
    return { task: taskHint, reason: "task override" };
  }
  if (imageDescription) {
    return { task: "vision", reason: "image description present" };
  }
  // SUPERFAST PRIORITY ROUTES - check these first
  if (matchesAny(prompt, GRAMMAR_PATTERNS)) {
    return { task: "grammar", reason: "grammar/correction keywords detected", model: "gemma:2b" };
  }
  if (matchesAny(prompt, PERSONAL_PATTERNS)) {
    return { task: "personal", reason: "personal/memory keywords detected", model: "gemma:2b" };
  }
  if (matchesAny(prompt, CONVERSATION_PATTERNS)) {
    return { task: "chat", reason: "conversation keywords detected", model: "llama3.2" };
  }
  if (matchesAny(prompt, IMAGE_PROMPT_PATTERNS)) {
    return { task: "image_prompt", reason: "image prompt keywords detected" };
  }
  if (matchesAny(prompt, VIDEO_PROMPT_PATTERNS)) {
    return { task: "video_prompt", reason: "video prompt keywords detected" };
  }
  if (matchesAny(prompt, DASHBOARD_PATTERNS)) {
    return { task: "dashboard", reason: "dashboard keywords detected" };
  }
  if (matchesAny(prompt, CHART_PATTERNS)) {
    return { task: "chart", reason: "chart keywords detected" };
  }
  if (matchesAny(prompt, REPORT_PATTERNS)) {
    return { task: "report", reason: "report keywords detected" };
  }
  if (matchesAny(prompt, RESEARCH_PATTERNS)) {
    return { task: "research", reason: "research keywords detected" };
  }
  if (matchesAny(prompt, DEBUG_PATTERNS)) {
    return { task: "debug", reason: "debug keywords detected" };
  }
  if (matchesAny(prompt, SQL_PATTERNS)) {
    return { task: "sql", reason: "sql keywords detected" };
  }
  if (matchesAny(prompt, CODE_PATTERNS)) {
    return { task: "code", reason: "code keywords detected" };
  }
  if (preferFast) {
    return { task: "fast", reason: "fast requested" };
  }
  return { task: "chat", reason: "default route", model: "llama3.2" };
}

export function shouldBypassHeavyWork(prompt) {
  const cleaned = String(prompt || "").trim();
  if (cleaned.length <= 80) return true;
  return cleaned.length <= 140 && !/[?]/.test(cleaned);
}

function resolveSafePath(projectRoot, inputPath) {
  const root = path.resolve(projectRoot);
  const resolved = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(projectRoot, inputPath);
  const rootLower = root.toLowerCase();
  const resolvedLower = resolved.toLowerCase();
  if (resolvedLower === rootLower || resolvedLower.startsWith(rootLower + path.sep)) {
    return resolved;
  }
  return null;
}

export async function loadFileContexts({ projectRoot, filePaths }) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { context: "", files: [] };
  }

  const files = [];
  const sections = [];

  for (const filePath of filePaths) {
    if (typeof filePath !== "string" || !filePath.trim()) continue;
    const safePath = resolveSafePath(projectRoot, filePath.trim());
    if (!safePath) {
      files.push({ path: filePath, status: "skipped_outside_project" });
      continue;
    }
    try {
      const content = await extractTextFromFile(safePath);
      const truncated = content.length > MAX_FILE_CHARS;
      const snippet = truncated ? content.slice(0, MAX_FILE_CHARS) : content;
      const relativePath = path.relative(projectRoot, safePath);
      sections.push(`--- ${relativePath} ---\n${snippet}`);
      files.push({
        path: relativePath,
        status: "included",
        truncated
      });
    } catch (err) {
      files.push({ path: filePath, status: "read_failed", error: err.message });
    }
  }

  return {
    context: sections.join("\n\n"),
    files
  };
}
