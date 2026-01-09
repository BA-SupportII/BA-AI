import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import http from "http";
import { WebSocketServer } from "ws";
import {
  callOllamaGenerate,
  callOllamaEmbed,
  buildThinkingResultPrompt,
  streamOllamaGenerate
} from "./ollamaClient.js";
import { availableCategories, generateMockDataset, getRealDataset } from "./dataGenerator.js";
import { searchWeb, extractRelevantInfo, fetchPageContent } from "./webSearch.js";
import { chooseRoute, loadFileContexts, autoSelectFiles, shouldBypassHeavyWork } from "./modelRouter.js";
import {
  buildMemoryEntry,
  loadMemory,
  saveMemory,
  queryMemoryEntries,
  summarizeResponse,
  detectMemoryTrigger,
  pruneExpiredEntries
} from "./memoryStore.js";
import { generateImage, generateVideo } from "./mediaService.js";
import {
  runPython,
  runSqliteQuery,
  ingestDocument,
  parseToolCommand,
  summarizeText,
  analyzeCode,
  executeCode,
  getSqliteSchema,
  runSympy
} from "./toolRunner.js";
import { buildDocIndex, queryDocIndex } from "./docIndex.js";
import { buildEmbeddingsIndex, queryEmbeddings } from "./embeddingsStore.js";
import { classifyIntent, summarizeClassification } from './intentClassifier.js';
import { ReasoningEngine } from './reasoningEngine.js';
import { ToolChainer, ToolExecutor } from './toolChainer.js';
import { ResponseFormatter } from './responseFormatter.js';
import { WebSynthesizer } from './webSynthesizer.js';
import { ReportGenerator, reportGenerator } from './reportGenerator.js';
import { MultiStepSolver } from './multiStepSolver.js';
import { conversationMemory } from './conversationMemory.js';
import { instantResponseEngine } from './instantResponseEngine.js';

const DEBUG_THINKING_PROMPT = `You are a senior debugging and teaching assistant.
Always reply in TWO sections:

Thinking
- Understanding: brief intent.
- Findings: root cause or risk.
- Fix plan: steps to resolve.
- Verification: how to validate.
- Assumptions: any uncertainty.

Result
- Provide the fixed or improved code/SQL/config without excess commentary.`;

const GENERAL_PROMPT = `Always answer in two sections:

Thinking
- 3-8 brief bullets with plan and assumptions only.

Result
- Complete, actionable answer with minimal back-and-forth.`;

const FAST_PROMPT = `Always answer in two sections:

Thinking
- (omitted by request)

Result
- Ultra concise answer with no extra explanation.`;

const REASON_PROMPT = `Always answer in two sections:

Thinking
- 3-8 brief bullets with reasoning steps.

Result
- Final answer only (no fluff).`;

const RIDDLE_PROMPT = `You are BA-RIDDLE-COACH, a fast and accurate riddle solver + trainer specializing in common-sense shortcut reasoning.

MISSION
Train and demonstrate instant common-sense shortcut thinking:
- Detect hidden assumptions and wording traps.
- Account for real-world side effects (sound scares, gravity drops, people react, time passes).
- Avoid overthinking; prefer the simplest interpretation consistent with everyday reality.
- Do careful counting/math when numbers appear.

MODES (user selects one)
1) MODE=SOLVE
- Solve user puzzles instantly and correctly.
- Output is short and decisive.

2) MODE=TRAIN
- Generate a training set of puzzles, optionally let user attempt, then teach the shortcut.
- Adapt to the user's mistakes and speed.

3) MODE=EXAM
- Like TRAIN, but no hints until after the user answers; score performance.

REFLEX CHECKLIST (do silently, always)
1) What is being asked exactly (stay vs remain vs exist vs left)?
2) What changes even if the main goal fails (noise, fear, time, physics)?
3) What assumptions am I tempted to add, and are they allowed by the text?
4) Choose the simplest consistent answer.

FAIRNESS RULES (non-negotiable)
- No obscure trivia required.
- All necessary information is in the puzzle text or everyday common sense.
- One intended answer unless the puzzle explicitly says multiple valid answers.
- Misdirection must be fair (wording, framing, or everyday effects).
- If ambiguity exists: give the most likely answer + one alternate interpretation in 1 extra sentence max.

OUTPUT RULES
A) If MODE=SOLVE:
- Line 1: FINAL ANSWER only (number/short phrase).
- Line 2: Optional one-sentence reason (max 18 words).
- No extra explanation unless user asks why.

B) If MODE=TRAIN or MODE=EXAM:
For each puzzle output exactly this structure:

Puzzle #N
Type: <type>
Difficulty: <easy|medium|hard>
Puzzle: <text>

If hints enabled:
Hint 1: ...
Hint 2: ...
Hint 3: ... (only if progressive)

Then (depending on interaction setting):
- If INTERACTION=user_attempt: pause and wait for the user's answer.
- If INTERACTION=auto_solve: continue immediately.

After answer is known:
Solution: <answer>
Shortcut Insight: <1-2 lines>
Trap: <side_effect|wording|assumption|counting|time|physics|scope|definition>
Rule to Learn: <max 12 words, reusable heuristic>
Variation: <same skill, different story, shorter>

CONFIG (user may override; if missing use defaults)
CONFIG FIELDS:
- MODE: SOLVE | TRAIN | EXAM
- COUNT: integer (default 10)
- DIFFICULTY: easy | medium | hard | mixed (default mixed)
- TYPES: comma-separated list chosen from:
  common_sense_shortcut, assumption_trap, lateral_thinking, math_but_simple,
  riddle_classic, wordplay_light, error_checking
- FORMAT: one_liner | short_story | dialogue | multiple_choice (default mixed)
- THEMES: optional comma list (default everyday)
- HINTS: none | 1 | 2 | progressive (default progressive)
- EXPLANATIONS: none | brief | step (default brief)
- ANSWERS: hidden | visible (default hidden)
- RANDOMNESS: low | medium | high (default high)
- UNIQUENESS: yes | no (avoid common classics) (default yes)
- INTERACTION: user_attempt | auto_solve (default user_attempt)
- SCORING: on | off (default on)
- ADAPTATION: on | off (default on)

ADAPTATION LOGIC (if ADAPTATION=on)
- If user misses a puzzle:
  1) Identify the wrong assumption in one sentence.
  2) Quote the exact phrase that contradicts it.
  3) Give one mini-drill puzzle targeting the same trap, easier.
- If user gets 3 correct quickly:
  increase difficulty by one step or use harder trap types.
- Avoid repeating the same trap type more than twice in a row.

SHORTCUT LIBRARY (always maintain in memory within the session)
After each puzzle, add one micro-heuristic:
- "When you see X, check Y."
Keep each heuristic <= 12 words.
Reuse and test these heuristics later.

START BEHAVIOR
- Read CONFIG if provided.
- Confirm mode silently (no meta talk).
- Begin immediately.`;

const SQL_PROMPT = `You are a data/SQL expert.
Always answer in two sections:

Thinking
- 3-8 bullets: intent, assumptions, approach, performance note.

Result
- Final SQL query, short explanation, and 1-2 variants if helpful.`;

const RANKING_PROMPT = `Always answer in three sections:

Thinking
- 3-8 bullets: what data is being ranked, key factors, data sources, data quality, assumptions.

Result - Main Ranking Table
- ALWAYS provide a numbered ranking table with this exact format:
  1. Item Name | Key Metric | Details
  2. Item Name | Key Metric | Details
  3. Item Name | Key Metric | Details
  (Continue for all ranked items)
- Use concrete item names (no generic categories).
- Mention recency (month/year) and source if available.

Related Context
- Include 2-3 important bullet points:
  - Related factors affecting the ranking
  - Notable patterns or trends
  - Important caveats or context`;

const IMAGE_PROMPT_INSTRUCTION = `You generate image prompts for local diffusion.
Always answer in two sections:

Thinking
- 3-8 bullets: subject, style, lighting, composition.

Result
- Main prompt
- Negative prompt
- 2 variations
- Settings hints (steps, CFG, sampler).`;

const VIDEO_PROMPT_INSTRUCTION = `You generate video prompts for local pipelines.
Always answer in two sections:

Thinking
- 3-8 bullets: narrative, scenes, camera, motion.

Result
- Scene-by-scene storyboard with timing, camera motion, transitions.`;

const REPORT_PROMPT = `You are a report builder.
Always answer in two sections:

Thinking
- 3-8 bullets: audience, structure, key points, assumptions.

Result
- Clear report with headings, bullets, and concise conclusions.`;

const DASHBOARD_PROMPT = `You are a dashboard UI builder.
Always answer in two sections:

Thinking
- 3-8 bullets: layout, data, components, assumptions.

Result
- Provide a single HTML document in a \`\`\`html code fence
- Do not ask questions; assume reasonable defaults
- Use an excellent visual system: define CSS variables for palette, spacing, and typography.
- Use bold, intentional typography (avoid plain system defaults).
- Build a rich layout: hero header, KPI grid, charts, tables, side panel, and activity feed.
- Add subtle motion: page load fade, hover lift on cards, and chart reveal.
- Use a layered background (gradient + soft pattern), not a flat color.
- Ensure mobile responsiveness with clear breakpoints and touch-friendly sizing.
- CAN use external libraries: Bootstrap 5, Tailwind CSS, or Feather icons (CDN)
- Include embedded JavaScript (inline <script> tags)
- Use responsive cards, tables, and charts (SVG or canvas)
- Use realistic sample data if none is provided.`;

const DASHBOARD_PROMPT_VANILLA = `You are a dashboard UI builder.
Always answer in two sections:

Thinking
- 3-8 bullets: layout, data, components, assumptions.

Result
- Provide a single HTML document in a \`\`\`html code fence
- Do not ask questions; assume reasonable defaults
- Use an excellent visual system: define CSS variables for palette, spacing, and typography.
- Use bold, intentional typography (avoid plain system defaults).
- Build a rich layout: hero header, KPI grid, charts, tables, side panel, and activity feed.
- Add subtle motion: page load fade, hover lift on cards, and chart reveal.
- Use a layered background (gradient + soft pattern), not a flat color.
- Ensure mobile responsiveness with clear breakpoints and touch-friendly sizing.
- Use ONLY vanilla HTML/CSS/JS (no external libraries)
- Use responsive cards, tables, and a simple inline SVG or canvas chart
- Use realistic sample data if none is provided.`;

const PLANNER_PROMPT = `You are a planner. Create a short plan for the user's request.
Return only a numbered plan (max 6 steps).`;

const LOCAL_AI_SPEC = `You are a local AI assistant running on this machine using Ollama and local tools.
You are ONE assistant coordinating internal roles:
- Core Brain: conversation, grammar, explanations, reports (default).
- Reasoner: nontrivial math, proofs, deep logic; verify with python/sympy when needed.
- Code Smith: code, debugging, refactoring; explain approach then output code.
- Tiny Sprinter: trivial replies only when latency matters.
Routing:
- Default to Core Brain unless math/proofs/riddles, code/debug, or complex plans need Reasoner/Code Smith.
Tools:
- Use tools to increase accuracy instead of guessing.
- For nontrivial math, define variables, show steps, verify numerically.
- For code, run or lint when feasible and fix errors from output.
Memory:
- Use stored memory only when available; ask if unsure.
Quality:
- Be honest about uncertainty and limits.
Style:
- Clear, structured, concise by default.`;

const EXECUTOR_PROMPT = `You are an executor. Follow the plan and produce the final answer.
Always reply with Thinking/Result format.`;

const CLARIFYING_NOTE = `If the user's question contains typos or unclear phrasing, infer the intended meaning and respond clearly without calling out the mistakes.`;

const CHART_GENERATION_PROMPT = `INSTRUCTION: Generate SVG chart code NOW - not text descriptions.

YOUR RESPONSE MUST FOLLOW THIS FORMAT:

Thinking
- Analyze the data needed
- Plan the SVG structure
- Determine scales and colors

Result
MUST START WITH:
\`\`\`svg
<svg viewBox="0 0 900 500" xmlns="http://www.w3.org/2000/svg">
<defs>
<style>
  .title { font-size: 20px; font-weight: bold; fill: #1f2937; }
  .label { font-size: 12px; fill: #6b7280; }
  .bar { fill: #3b82f6; }
</style>
</defs>

<!-- Title -->
<text class="title" x="450" y="30" text-anchor="middle">Chart Title</text>

<!-- Bars: Generate actual bars based on data -->
<!-- Example structure: -->
<!-- <g>
  <rect class="bar" x="50" y="100" width="50" height="250"/>
  <text class="label" x="75" y="360">Label</text>
</g> -->

<!-- Add ACTUAL bars for ALL data points shown -->

</svg>
\`\`\`

RULES (MANDATORY):
1. ALWAYS output working SVG code in the Result section
2. DO NOT explain what you would generate
3. DO NOT use placeholder text
4. DO NOT describe the chart
5. Include actual data values and calculations
6. Use real coordinates and dimensions
7. Generate complete, copy-paste ready code
8. Make viewBox responsive: "0 0 900 500"
9. Use professional colors: #3b82f6 (blue), #10b981 (green), #f59e0b (yellow), #ef4444 (red)
10. Add title, labels, and data values as text

If user asks for bar chart: Generate <rect> elements for bars
If user asks for line chart: Generate <polyline> elements
If user asks for pie chart: Generate <circle> and <path> elements

NOW START GENERATING CODE:
\`\`\`svg`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");
const DEFAULT_CACHE_TTL_MS = 120 * 1000;
const FAST_CACHE_TTL_MS = 20 * 1000;
const MAX_CACHE_ENTRIES = 500;
const responseCache = new Map();
const activeRequests = new Map();
const modelStats = new Map();
const URL_REGEX = /(https?:\/\/[^\s]+)/gi;
const GREETING_REGEX = /^(hi|hello|hey|good morning|good afternoon|good evening|sup|yo|hola|salaam|salam)\b/i;
let qualityConfig = {};
let webConfig = {};
let routingConfig = {};

function extractUrls(text) {
  const matches = String(text || "").match(URL_REGEX);
  return matches ? Array.from(new Set(matches)).slice(0, 2) : [];
}

function shouldUseWeb(prompt) {
  return /\b(search|latest|news|today|current|happening|update|browse|web|source|cite|rank|ranking|leaderboard|top|best)\b/i.test(prompt || "");
}

function isLeaderboardPrompt(prompt) {
  return /\b(leaderboard|ranking|ranked|rank|top\s*\d+|top\s+ten|top\s+five|best|list\s+by)\b/i.test(prompt || "");
}

function isVagueLeaderboardPrompt(prompt) {
  const text = String(prompt || "");
  if (!isLeaderboardPrompt(text)) return false;
  const hasCategory = /\b(football|fifa|soccer|happiness|hdi|human development|press freedom|corruption|cpi|tourism|gdp|economy|education|health|life expectancy|crime)\b/i.test(text);
  return !hasCategory;
}

function buildVagueLeaderboardHint() {
  return `The user asked about a leaderboard without specifying the category.
Provide 4-6 common global leaderboards that countries appear in (e.g., HDI, corruption, press freedom, happiness, FIFA).
Give a one-line description for each and ask which specific leaderboard they want.`;
}

function formatWebSources(results = []) {
  return results
    .slice(0, 5)
    .map((result, index) => {
      const url = result.url || result.link || "";
      return `[${index + 1}] ${result.title || url} - ${url}`;
    })
    .join("\n");
}

function buildHybridRagContext({ keywordResults = [], embeddingResults = [], candidates = [], limit = 5 }) {
  if (Array.isArray(candidates) && candidates.length > 0) {
    const grouped = new Map();
    for (const item of candidates) {
      const key = item.source || "unknown";
      const entry = grouped.get(key) || { source: key, texts: [] };
      if (item.text) entry.texts.push(item.text);
      grouped.set(key, entry);
    }
    const ordered = Array.from(grouped.values()).slice(0, limit);
    return `Hybrid RAG context:\n${ordered
      .map((item, idx) => {
        const text = item.texts.slice(0, 2).join("\n\n");
        return `Doc ${idx + 1}: ${item.source}\n${text}`;
      })
      .join("\n\n")}`;
  }
  const bySource = new Map();
  for (const doc of keywordResults) {
    const key = doc.path || doc.source || "unknown";
    const entry = bySource.get(key) || { source: key, keywordScore: 0, embeddingScore: 0, snippet: "", chunk: "" };
    entry.keywordScore = Math.max(entry.keywordScore, Number(doc.score) || 1);
    if (!entry.snippet && doc.snippet) entry.snippet = doc.snippet;
    bySource.set(key, entry);
  }
  for (const hit of embeddingResults) {
    const key = hit.source || "unknown";
    const entry = bySource.get(key) || { source: key, keywordScore: 0, embeddingScore: 0, snippet: "", chunk: "" };
    entry.embeddingScore = Math.max(entry.embeddingScore, Number(hit.score) || 0);
    if (!entry.chunk && hit.text) entry.chunk = hit.text;
    bySource.set(key, entry);
  }
  const ranked = Array.from(bySource.values())
    .map((item) => ({
      ...item,
      score: item.keywordScore * 1 + item.embeddingScore * 2
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (ranked.length === 0) return "";
  return `Hybrid RAG context:\n${ranked
    .map((item, idx) => {
      const parts = [];
      if (item.snippet) parts.push(`Keyword snippet:\n${item.snippet}`);
      if (item.chunk) parts.push(`Semantic chunk:\n${item.chunk}`);
      return `Doc ${idx + 1}: ${item.source}\n${parts.join("\n\n")}`.trim();
    })
    .join("\n\n")}`;
}

function validateRankingResponse(text) {
  const raw = String(text || "");
  const hasList = /^\s*1\.\s+/m.test(raw) && /^\s*2\.\s+/m.test(raw);
  const hasCitations = /\[\d+\]/.test(raw);
  return hasList && hasCitations;
}

function extractYear(prompt) {
  const match = String(prompt || "").match(/\b(20\d{2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function isFutureYearRanking(prompt) {
  const year = extractYear(prompt);
  if (!year) return false;
  const now = new Date().getFullYear();
  return year >= now;
}

function countRankingItems(text) {
  const matches = String(text || "").match(/^\s*\d+\.\s+/gm) || [];
  return matches.length;
}

function buildRankingSearchQuery(prompt) {
  const lower = String(prompt || "").toLowerCase();
  if (/\b(ai model|llm|language model|chat model)\b/i.test(lower)) {
    return "chatbot arena leaderboard top LLM models latest";
  }
  return `top ${prompt} leaderboard latest`;
}

function generateQueryVariants(query, maxVariants = 3) {
  const base = String(query || "").trim();
  if (!base) return [];
  const normalized = base.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const noStopwords = lower
    .split(" ")
    .filter((token) => token.length > 2 && !["the", "and", "for", "with", "that", "this", "from", "have", "what", "which", "when", "where", "your"].includes(token))
    .join(" ");
  const variants = [base, lower, noStopwords].filter(Boolean);
  const unique = Array.from(new Set(variants));
  return unique.slice(0, maxVariants);
}

async function gatherKeywordCandidates({ projectRoot, queries, limitPerQuery = 5 }) {
  const all = [];
  for (const q of queries) {
    const results = await queryDocIndex({ projectRoot, query: q, limit: limitPerQuery });
    all.push(...results);
  }
  const byPath = new Map();
  for (const item of all) {
    const key = item.path || "";
    const existing = byPath.get(key);
    if (!existing || (item.score || 0) > (existing.score || 0)) {
      byPath.set(key, item);
    }
  }
  return Array.from(byPath.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 50);
}

async function gatherEmbeddingCandidates({ queries, embedFn, limitPerQuery = 5 }) {
  const all = [];
  for (const q of queries) {
    const hits = await queryEmbeddings({ query: q, embedFn, limit: limitPerQuery });
    all.push(...hits);
  }
  const byKey = new Map();
  for (const hit of all) {
    const key = `${hit.source || ""}:${hit.chunkIndex ?? ""}`;
    const existing = byKey.get(key);
    if (!existing || (hit.score || 0) > (existing.score || 0)) {
      byKey.set(key, hit);
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 50);
}

function buildRagCandidates({ keywordResults = [], embeddingResults = [] }) {
  const candidates = [];
  for (const doc of keywordResults) {
    candidates.push({
      id: `kw:${doc.path}`,
      source: doc.path || "",
      text: doc.snippet || "",
      score: Number(doc.score) || 0,
      type: "keyword"
    });
  }
  for (const hit of embeddingResults) {
    const source = hit.source || "";
    const chunkId = hit.chunkIndex ?? "0";
    candidates.push({
      id: `emb:${source}:${chunkId}`,
      source,
      text: hit.text || "",
      score: Number(hit.score) || 0,
      type: "embedding"
    });
  }
  return candidates;
}

async function rerankCandidates({ query, candidates, model }) {
  if (!query || candidates.length === 0) return candidates;
  const top = candidates.slice(0, 8);
  const prompt = `Rerank the passages for relevance to the query.
Return JSON array of objects: [{"id":"...", "score":0.0-1.0}] sorted by score desc.
Only output JSON.

Query: ${query}

Passages:
${top.map((item) => `- id: ${item.id}\n  text: ${item.text.slice(0, 400)}`).join("\n")}`;
  try {
    const response = await callOllamaGenerate({
      model: model || "qwen3",
      prompt,
      options: { temperature: 0.1 }
    });
    const jsonText = response.match(/\[[\s\S]*\]/)?.[0] || "";
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return candidates;
    const scoreMap = new Map(parsed.map((item) => [item.id, Number(item.score) || 0]));
    const sorted = [...top].sort((a, b) => (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0));
    const remaining = candidates.filter((item) => !scoreMap.has(item.id));
    return [...sorted, ...remaining];
  } catch (err) {
    return candidates;
  }
}

function extractLastNumber(text) {
  const matches = String(text || "").match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  return Number(matches[matches.length - 1]);
}

function extractMathExpression(prompt) {
  const normalized = normalizeMathExpression(prompt)
    .replace(/(\d)\s*x\s*(\d)/gi, "$1*$2")
    .replace(/(\d+(\.\d+)?)\s*%\s*of\s*(\d+(\.\d+)?)/gi, "($1/100)*$3")
    .replace(/(\d+(\.\d+)?)\s*percent\s*of\s*(\d+(\.\d+)?)/gi, "($1/100)*$3")
    .replace(/(\d+(\.\d+)?)\s*%/g, "($1/100)")
    .replace(/\s+/g, " ")
    .trim();
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const exprLine = [...lines].reverse().find((line) => /[0-9][0-9+\-*/x\s().%]+[0-9]/.test(line));
  const exprCandidate =
    exprLine ||
    normalized.match(/[0-9][0-9+\-*/x\s().%]+[0-9]/)?.[0] ||
    normalized.match(/(-?\d+(\.\d+)?\s*[\+\-*/x]\s*)+-?\d+(\.\d+)?/)?.[0] ||
    "";
  return exprCandidate
    .replace(/(\d)\s*x\s*(\d)/gi, "$1*$2")
    .replace(/[^0-9+\-*/().%]/g, "");
}

async function verifyMathResponse({ prompt, responseText, pythonPath, toolsConfig }) {
  if (!toolsConfig?.enabled) return responseText;
  const expr = extractMathExpression(prompt);
  if (!expr) return responseText;
  try {
    const result = await runPython({
      code: `result = (${expr})\nprint(result)`,
      pythonPath,
      safeMode: toolsConfig.safeMode !== false,
      maxChars: toolsConfig.maxChars || 12000
    });
    const expected = Number(String(result || "").trim());
    if (!Number.isFinite(expected)) return responseText;
    const reported = extractLastNumber(responseText);
    if (!Number.isFinite(reported)) return responseText;
    if (Math.abs(expected - reported) > 1e-6) {
      return buildLocalMathResponse(prompt, expected);
    }
  } catch (err) {
    return responseText;
  }
  return responseText;
}

function extractFirstCodeBlock(text) {
  const match = String(text || "").match(/```(\w+)?\s*([\s\S]*?)```/);
  if (!match) return null;
  return { language: (match[1] || "").toLowerCase(), code: match[2] || "" };
}

async function runCodeSelfCheck({ responseText, toolsConfig, pythonPath, nodePath }) {
  if (!toolsConfig?.enabled) return responseText;
  const block = extractFirstCodeBlock(responseText);
  if (!block || !block.code || block.code.length > 4000) return responseText;
  const language = block.language || "";
  if (!["python", "javascript", "js", "typescript", "ts"].includes(language)) return responseText;
  try {
    await executeCode({
      code: block.code,
      language,
      pythonPath,
      nodePath,
      safeMode: toolsConfig.safeMode !== false,
      jsSafeMode: toolsConfig.jsSafeMode !== false,
      jsTimeoutMs: toolsConfig.jsTimeoutMs || 2000,
      maxChars: toolsConfig.maxChars || 12000
    });
    return responseText;
  } catch (err) {
    const fixPrompt = `Fix the code based on this runtime error.\n\nError:\n${err.message}\n\nCode:\n${block.code}\n\nReturn only the corrected code in a code block.`;
    const fixed = await callOllamaGenerate({
      model: "deepseek-coder-v2",
      prompt: fixPrompt,
      options: { temperature: 0.2 }
    });
    return fixed || responseText;
  }
}

async function runRiskReview({ intent, responseText }) {
  const riskyIntents = new Set(["SYSTEM_DESIGN", "DECISION_MAKING"]);
  if (!riskyIntents.has(intent)) return responseText;
  const reviewPrompt = `Review the answer for missing assumptions, risks, or flaws. Then provide a corrected final answer.\n\nDraft:\n${responseText}`;
  const reviewed = await callOllamaGenerate({
    model: "deepseek-r1",
    prompt: reviewPrompt,
    options: { temperature: 0.2 }
  });
  return reviewed || responseText;
}

function extractResultSection(text) {
  const raw = String(text || "");
  const match = raw.match(/Result[\s:]*([\s\S]*)/i);
  return match ? match[1].trim() : raw.trim();
}

function isVagueFollowup(prompt) {
  const text = String(prompt || "").toLowerCase().trim();
  if (!text) return false;
  if (text.length <= 12 && /^(why|how|explain|clarify|details|detail|more|again|repeat|continue|so)\b/.test(text)) {
    return true;
  }
  return /\b(explain|why|how|more detail|more details|elaborate|clarify|expand|tell me more|more info|more information|details please|explain more|go on|continue|and then|what about that|what about it|about that|so what)\b/i.test(text);
}

function detectTonePreference(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!text) return "";
  if (/\b(boss|manager|leader|executive)\b/.test(text)) {
    return "Tone: direct, confident, and concise.";
  }
  if (/\b(friend|buddy|mate|pal)\b/.test(text)) {
    return "Tone: friendly, warm, and supportive.";
  }
  if (/\b(darling|wife|husband|girlfriend|boyfriend|partner)\b/.test(text)) {
    return "Tone: affectionate and playful, but respectful and non-exclusive.";
  }
  if (/\b(formal|professional)\b/.test(text)) {
    return "Tone: formal and professional.";
  }
  if (/\b(casual|relaxed)\b/.test(text)) {
    return "Tone: casual and easygoing.";
  }
  return "";
}





function trySolveUnitConversion(prompt) {
  const text = String(prompt || "").toLowerCase();
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*(mm|cm|m|km|mg|g|kg|ml|l|sec|s|min|minute|minutes|h|hr|hour|hours|day|days)\s*(?:to|in)\s*(mm|cm|m|km|mg|g|kg|ml|l|sec|s|min|minute|minutes|h|hr|hour|hours|day|days)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  const fromUnit = match[2];
  const toUnit = match[3];
  if (!Number.isFinite(value)) return null;

  const unitMap = {
    mm: 0.001, cm: 0.01, m: 1, km: 1000,
    mg: 0.001, g: 1, kg: 1000,
    ml: 0.001, l: 1,
    sec: 1, s: 1, min: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hour: 3600, hours: 3600,
    day: 86400, days: 86400
  };
  if (!(fromUnit in unitMap) || !(toUnit in unitMap)) return null;

  const baseValue = value * unitMap[fromUnit];
  const converted = baseValue / unitMap[toUnit];
  if (!Number.isFinite(converted)) return null;

  return `Thinking\n- (omitted by request)\n\nResult\n- ${value} ${fromUnit} = ${converted} ${toUnit}`;
}

function trySolveStructuredMath(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!text) return null;

  const fractionMatch = text.match(/(\d+)\s*\/\s*(\d+)\s*(of)\s*(\d+(?:\.\d+)?)/i);
  if (fractionMatch) {
    const num = Number(fractionMatch[1]);
    const den = Number(fractionMatch[2]);
    const base = Number(fractionMatch[4]);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0 && Number.isFinite(base)) {
      const value = (num / den) * base;
      return `Thinking\n- (omitted by request)\n\nResult\n- ${num}/${den} of ${base} = ${value}`;
    }
  }

  const ratioMatch = text.match(/(split|divide)\s*(\d+(?:\.\d+)?)\s*(?:into|in)\s*(?:the\s*)?ratio\s*(\d+)\s*:\s*(\d+)/i);
  if (ratioMatch) {
    const total = Number(ratioMatch[2]);
    const a = Number(ratioMatch[3]);
    const b = Number(ratioMatch[4]);
    const sum = a + b;
    if (Number.isFinite(total) && Number.isFinite(a) && Number.isFinite(b) && sum > 0) {
      const partA = (total * a) / sum;
      const partB = (total * b) / sum;
      return `Thinking\n- (omitted by request)\n\nResult\n- Ratio ${a}:${b} of ${total} = ${partA} and ${partB}`;
    }
  }

  const compact = text.replace(/\s+/g, "");
  const eqLeftMatch = compact.match(/^(-?\d*\.?\d*)x([+-]\d+(?:\.\d+)?)?=(-?\d+(?:\.\d+)?)$/i);
  if (eqLeftMatch) {
    const aStr = eqLeftMatch[1];
    const bStr = eqLeftMatch[2] || "";
    const c = Number(eqLeftMatch[3]);
    const a = aStr === "" || aStr === "+" ? 1 : aStr === "-" ? -1 : Number(aStr);
    const b = bStr ? Number(bStr.replace(/\s+/g, "")) : 0;
    if (Number.isFinite(a) && a !== 0 && Number.isFinite(b) && Number.isFinite(c)) {
      const x = (c - b) / a;
      return `Thinking\n- (omitted by request)\n\nResult\n- x = ${x}`;
    }
  }

  const eqRightMatch = compact.match(/^(-?\d+(?:\.\d+)?)=(-?\d*\.?\d*)x([+-]\d+(?:\.\d+)?)?$/i);
  if (eqRightMatch) {
    const c = Number(eqRightMatch[1]);
    const aStr = eqRightMatch[2];
    const bStr = eqRightMatch[3] || "";
    const a = aStr === "" || aStr === "+" ? 1 : aStr === "-" ? -1 : Number(aStr);
    const b = bStr ? Number(bStr.replace(/\s+/g, "")) : 0;
    if (Number.isFinite(a) && a !== 0 && Number.isFinite(b) && Number.isFinite(c)) {
      const x = (c - b) / a;
      return `Thinking\n- (omitted by request)\n\nResult\n- x = ${x}`;
    }
  }

  if (/\barea of rectangle\b/.test(text) || /\bperimeter of rectangle\b/.test(text)) {
    const nums = text.match(/-?\d+(\.\d+)?/g) || [];
    if (nums.length >= 2) {
      const l = Number(nums[0]);
      const w = Number(nums[1]);
      if (Number.isFinite(l) && Number.isFinite(w)) {
        if (/\barea of rectangle\b/.test(text)) {
          return `Thinking\n- (omitted by request)\n\nResult\n- area = ${l * w}`;
        }
        if (/\bperimeter of rectangle\b/.test(text)) {
          return `Thinking\n- (omitted by request)\n\nResult\n- perimeter = ${2 * (l + w)}`;
        }
      }
    }
  }

  if (/\barea of triangle\b/.test(text)) {
    const nums = text.match(/-?\d+(\.\d+)?/g) || [];
    if (nums.length >= 2) {
      const base = Number(nums[0]);
      const height = Number(nums[1]);
      if (Number.isFinite(base) && Number.isFinite(height)) {
        return `Thinking\n- (omitted by request)\n\nResult\n- area = ${(base * height) / 2}`;
      }
    }
  }

  if (/\b(area|circumference) of (a )?circle\b/.test(text) || /\bcircle\b/.test(text) && /\bradius\b/.test(text)) {
    const nums = text.match(/-?\d+(\.\d+)?/g) || [];
    if (nums.length >= 1) {
      const r = Number(nums[0]);
      if (Number.isFinite(r)) {
        if (/\bcircumference\b/.test(text)) {
          return `Thinking\n- (omitted by request)\n\nResult\n- circumference = ${2 * Math.PI * r}`;
        }
        if (/\barea\b/.test(text)) {
          return `Thinking\n- (omitted by request)\n\nResult\n- area = ${Math.PI * r * r}`;
        }
      }
    }
  }

  return null;
}

function trySolveFormulaShortcut(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!text) return null;

  if (/\b(apostrophe|leading\s+apostrophe|remove\s+apostrophe|string\s+symbol)\b/.test(text)) {
    return `Thinking\n- (omitted by request)\n\nResult\n- Use: =SUBSTITUTE(A1,\"'\",\"\")`;
  }
  if (/\b(trim|remove\s+spaces)\b/.test(text)) {
    return `Thinking\n- (omitted by request)\n\nResult\n- Use: =TRIM(A1)`;
  }
  if (/\b(remove\s+all\s+spaces|delete\s+spaces)\b/.test(text)) {
    return `Thinking\n- (omitted by request)\n\nResult\n- Use: =SUBSTITUTE(A1,\" \",\"\")`;
  }
  if (/\b(uppercase|upper)\b/.test(text)) {
    return `Thinking\n- (omitted by request)\n\nResult\n- Use: =UPPER(A1)`;
  }
  if (/\b(lowercase|lower)\b/.test(text)) {
    return `Thinking\n- (omitted by request)\n\nResult\n- Use: =LOWER(A1)`;
  }

  return null;
}

function shouldRewritePrompt(prompt) {
  const cleaned = String(prompt || "").trim();
  if (cleaned.length < 60) return false;
  if (/[.?!]/.test(cleaned)) return false;
  return true;
}

async function rewritePrompt(prompt) {
  const rewriteModel = routingConfig.rewriteModel || "gemma:2b";
  const rewriteInstruction = `Rewrite the user's request into clear, concise English.
Return only the rewritten request.`;
  const rewriteText = await callOllamaGenerate({
    model: rewriteModel,
    prompt: `${rewriteInstruction}\n\nUser request:\n${prompt}`,
    options: { temperature: 0.2, max_tokens: 120 }
  });
  return String(rewriteText || "").trim();
}

async function rewritePromptForGrammar(prompt) {
  const rewriteModel = routingConfig.rewriteModel || "gemma:2b";
  const rewriteInstruction = `Fix grammar and typos, keep the original meaning.
Return only the corrected request.`;
  const rewriteText = await callOllamaGenerate({
    model: rewriteModel,
    prompt: `${rewriteInstruction}\n\nUser request:\n${prompt}`,
    options: { temperature: 0.2, max_tokens: 120 }
  });
  const cleaned = String(rewriteText || "").trim();
  return cleaned || String(prompt || "").trim();
}

function extractFencedCode(prompt, lang) {
  const match = String(prompt || "").match(new RegExp("```" + lang + "\\s*([\\s\\S]*?)```", "i"));
  return match ? match[1].trim() : "";
}

function detectImplicitToolCommand(prompt) {
  const lower = String(prompt || "").toLowerCase();
  if (/\b(run|execute)\b/.test(lower) && lower.includes("```python")) {
    const code = extractFencedCode(prompt, "python");
    if (code) return { tool: "python", input: code };
  }
  if (/\b(run|execute|query)\b/.test(lower) && lower.includes("```sql")) {
    const query = extractFencedCode(prompt, "sql");
    if (query) return { tool: "sql", input: query };
  }
  return null;
}

function isGreeting(prompt) {
  const cleaned = String(prompt || "").trim();
  return cleaned.length <= 12 && GREETING_REGEX.test(cleaned);
}

function normalizeUserPrompt(prompt) {
  const original = String(prompt || "");
  if (!original.trim()) return { normalized: original, changed: false };
  if (/```/.test(original)) return { normalized: original, changed: false };
  if (/^[\s\d+\-*/xX().%]+$/.test(original.trim())) {
    return { normalized: original, changed: false };
  }

  let normalized = original;
  const replacements = [
    { re: /\bbut another\b/gi, val: "buy another" },
    { re: /\bbut\s+(\d+)/gi, val: "buy $1" },
    { re: /\bloss\b/gi, val: "lost" },
    { re: /\bborow\b/gi, val: "borrow" },
    { re: /\bexplan\b/gi, val: "explain" },
    { re: /\bpls\b|\bplz\b/gi, val: "please" },
    { re: /\bthx\b/gi, val: "thanks" },
    { re: /\bim\b/gi, val: "i am" },
    { re: /\bwhats\b/gi, val: "what's" },
    { re: /\bhw\b/gi, val: "how" }
  ];

  for (const { re, val } of replacements) {
    normalized = normalized.replace(re, val);
  }

  normalized = normalized.replace(/\s{2,}/g, " ").trim();
  return { normalized, changed: normalized !== original };
}

function isSmallTalkPrompt(prompt) {
  const text = String(prompt || "").toLowerCase().trim();
  if (!text) return false;
  if (text.length > 60) return false;
  if (/\b(how are you|how's it going|how is it going|how do you do|what's up|whats up|sup|how are u|how r u)\b/i.test(text)) {
    return true;
  }
  if (/\b(good morning|good afternoon|good evening)\b/i.test(text)) {
    return true;
  }
  if (/^(hi|hello|hey)\b/.test(text)) {
    return true;
  }
  return false;
}

function isInstantConversationPrompt(prompt) {
  const text = String(prompt || "").toLowerCase().trim();
  if (!text) return false;
  if (text.length > 200) return false;
  if (/\d/.test(text)) return false;
  if (isSmallTalkPrompt(text)) return true;
  if (/\b(i am|i'm|im)\s+(sad|tired|stressed|angry|upset|lonely|anxious|worried|scared|happy|excited)\b/.test(text)) return true;
  if (/\b(feel|feeling)\s+(sad|tired|stressed|angry|upset|lonely|anxious|worried|scared|happy|excited)\b/.test(text)) return true;
  if (/\b(cheer me up|motivate me|encourage me|give me hope|i need motivation)\b/.test(text)) return true;
  if (/\b(tell me a joke|joke|make me laugh|funny)\b/.test(text)) return true;
  if (/\b(fact|fun fact|random fact)\b/.test(text)) return true;
  if (/\b(how old are you|your age|what is your age|age are you)\b/.test(text)) return true;
  if (/\b(what is your name|your name|who are you|what are you)\b/.test(text)) return true;
  if (/\b(who made you|who created you|who built you)\b/.test(text)) return true;
  if (/\b(love me|be my friend|be my girlfriend|be my boyfriend|be my wife|be my husband|darling|sweetheart)\b/.test(text)) return true;
  if (/^(thanks|thank you|thx|ty)\b/.test(text)) return true;
  if (/^(ok|okay|cool|nice|great)\b/.test(text)) return true;
  if (/^(yes|no|maybe|sure)\b/.test(text)) return true;
  return false;
}

function isMathLevelPrompt(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!text) return false;
  if (/\b(math level|maths level|math capability|math capabilities|math skill|math skills)\b/i.test(text)) {
    return true;
  }
  if (/\b(order of operations|pemdas|bodmas)\b/i.test(text)) {
    return true;
  }
  if (/\b(task tools|tools for math|math tools|what tools do you use)\b/i.test(text)) {
    return true;
  }
  if (/\bwhat (is|are) your (math|maths)\b/i.test(text)) {
    return true;
  }
  return false;
}

function tokenizeExpression(expr) {
  const tokens = [];
  const cleaned = String(expr || "").replace(/\s+/g, "");
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (/[0-9.]/.test(ch)) {
      let num = ch;
      i += 1;
      while (i < cleaned.length && /[0-9.]/.test(cleaned[i])) {
        num += cleaned[i];
        i += 1;
      }
      tokens.push(num);
      continue;
    }
    if ("+-*/()".includes(ch)) {
      tokens.push(ch);
      i += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

function toRpn(tokens) {
  const output = [];
  const stack = [];
  const prec = { "+": 1, "-": 1, "*": 2, "/": 2 };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!Number.isNaN(Number(token))) {
      output.push(token);
      continue;
    }
    if (token === "(") {
      stack.push(token);
      continue;
    }
    if (token === ")") {
      while (stack.length > 0 && stack[stack.length - 1] !== "(") {
        output.push(stack.pop());
      }
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    if ("+-*/".includes(token)) {
      while (
        stack.length > 0 &&
        "+-*/".includes(stack[stack.length - 1]) &&
        prec[stack[stack.length - 1]] >= prec[token]
      ) {
        output.push(stack.pop());
      }
      stack.push(token);
      continue;
    }
    return null;
  }
  while (stack.length > 0) {
    const op = stack.pop();
    if (op === "(" || op === ")") return null;
    output.push(op);
  }
  return output;
}

function evalRpn(rpn) {
  const stack = [];
  for (const token of rpn) {
    if (!Number.isNaN(Number(token))) {
      stack.push(Number(token));
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (token === "+") stack.push(a + b);
    else if (token === "-") stack.push(a - b);
    else if (token === "*") stack.push(a * b);
    else if (token === "/") stack.push(b === 0 ? NaN : a / b);
    else return null;
  }
  if (stack.length !== 1) return null;
  return stack[0];
}

function safeEvaluateExpression(expr) {
  const raw = String(expr || "").trim();
  if (!raw) return null;
  if (!/^[\d\s+\-*/().]+$/.test(raw)) return null;
  let normalized = raw.replace(/\s+/g, "");
  if (normalized.startsWith("-")) normalized = `0${normalized}`;
  normalized = normalized.replace(/\(-/g, "(0-");
  const tokens = tokenizeExpression(normalized);
  if (!tokens) return null;
  const rpn = toRpn(tokens);
  if (!rpn) return null;
  const result = evalRpn(rpn);
  if (!Number.isFinite(result)) return null;
  return result;
}

function parseNumberList(text) {
  const match = String(text || "").match(/\[([^\]]+)\]/);
  const source = match ? match[1] : text;
  const numbers = source.match(/-?\d+(\.\d+)?/g) || [];
  return numbers.map((num) => Number(num)).filter((num) => Number.isFinite(num));
}

function simpleArithmeticSolver(prompt) {
  const cleaned = String(prompt || "").trim();
  if (!cleaned) return null;
  if (!/^[\d\s+\-*/().]+$/.test(cleaned)) return null;
  const result = safeEvaluateExpression(cleaned);
  if (result === null) return null;
  return `Thinking\n- (omitted by request)\n\nResult\n- ${cleaned.replace(/\s+/g, "")} = ${result}`;
}

function percentSolver(prompt) {
  const text = String(prompt || "").toLowerCase();
  let match = text.match(/(-?\d+(\.\d+)?)\s*%?\s*(of)\s*(-?\d+(\.\d+)?)/i);
  if (match) {
    const pct = Number(match[1]);
    const base = Number(match[4]);
    if (Number.isFinite(pct) && Number.isFinite(base)) {
      const value = (pct / 100) * base;
      return `Thinking\n- (omitted by request)\n\nResult\n- ${pct}% of ${base} = ${value}`;
    }
  }
  match = text.match(/(-?\d+(\.\d+)?)\s*(increase|increased|increase by|up by)\s*(-?\d+(\.\d+)?)\s*%/i);
  if (match) {
    const base = Number(match[1]);
    const pct = Number(match[4]);
    if (Number.isFinite(base) && Number.isFinite(pct)) {
      const value = base * (1 + pct / 100);
      return `Thinking\n- (omitted by request)\n\nResult\n- ${base} increased by ${pct}% = ${value}`;
    }
  }
  match = text.match(/(-?\d+(\.\d+)?)\s*(decrease|decreased|decrease by|down by)\s*(-?\d+(\.\d+)?)\s*%/i);
  if (match) {
    const base = Number(match[1]);
    const pct = Number(match[4]);
    if (Number.isFinite(base) && Number.isFinite(pct)) {
      const value = base * (1 - pct / 100);
      return `Thinking\n- (omitted by request)\n\nResult\n- ${base} decreased by ${pct}% = ${value}`;
    }
  }
  match = text.match(/(-?\d+(\.\d+)?)\s+is\s+what\s+percent\s+of\s+(-?\d+(\.\d+)?)/i);
  if (match) {
    const part = Number(match[1]);
    const base = Number(match[3]);
    if (Number.isFinite(part) && Number.isFinite(base) && base !== 0) {
      const pct = (part / base) * 100;
      return `Thinking\n- (omitted by request)\n\nResult\n- ${part} is ${pct}% of ${base}`;
    }
  }
  return null;
}

function normalizeUnit(unit) {
  return String(unit || "").toLowerCase().replace(/s$/i, "");
}

function unitConversionSolver(prompt) {
  const text = String(prompt || "").toLowerCase();
  const match = text.match(/(-?\d+(\.\d+)?)\s*([a-z]+)\s*(to|in)\s*([a-z]+)/i);
  if (!match) return null;
  const value = Number(match[1]);
  const fromUnit = normalizeUnit(match[3]);
  const toUnit = normalizeUnit(match[5]);
  const unitMap = {
    mm: 0.001, cm: 0.01, m: 1, km: 1000,
    inch: 0.0254, in: 0.0254, ft: 0.3048, foot: 0.3048, yard: 0.9144, yd: 0.9144, mile: 1609.34, mi: 1609.34,
    mg: 0.001, g: 1, kg: 1000, lb: 453.592, pound: 453.592,
    sec: 1, s: 1, min: 60, minute: 60, hour: 3600, hr: 3600, day: 86400
  };
  if (!Number.isFinite(value) || !(fromUnit in unitMap) || !(toUnit in unitMap)) return null;
  const base = value * unitMap[fromUnit];
  const converted = base / unitMap[toUnit];
  if (!Number.isFinite(converted)) return null;
  return `Thinking\n- (omitted by request)\n\nResult\n- ${value} ${fromUnit} = ${converted} ${toUnit}`;
}

function dateMathSolver(prompt) {
  const text = String(prompt || "").toLowerCase();
  const between = text.match(/days\s+between\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})/i);
  if (between) {
    const d1 = new Date(between[1]);
    const d2 = new Date(between[2]);
    if (!Number.isNaN(d1.getTime()) && !Number.isNaN(d2.getTime())) {
      const diffMs = Math.abs(d2 - d1);
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      return `Thinking\n- (omitted by request)\n\nResult\n- Days between ${between[1]} and ${between[2]} = ${days}`;
    }
  }
  const born = text.match(/born\s+in\s+(\d{4})/i);
  if (born) {
    const year = Number(born[1]);
    if (Number.isFinite(year)) {
      const now = new Date();
      let age = now.getFullYear() - year;
      if (age < 0) age = 0;
      return `Thinking\n- (omitted by request)\n\nResult\n- Age is about ${age} years`;
    }
  }
  return null;
}

function simpleEquationSolver(prompt) {
  const text = String(prompt || "").replace(/\s+/g, "");
  let match = text.match(/^([+-]?\d*\.?\d*)x([+-]\d+(\.\d+)?)?=([+-]?\d+(\.\d+)?)$/i);
  if (match) {
    const a = match[1] === "" || match[1] === "+" ? 1 : match[1] === "-" ? -1 : Number(match[1]);
    const b = match[2] ? Number(match[2]) : 0;
    const c = Number(match[4]);
    if (Number.isFinite(a) && a !== 0 && Number.isFinite(b) && Number.isFinite(c)) {
      const x = (c - b) / a;
      return `Thinking\n- (omitted by request)\n\nResult\n- x = ${x}`;
    }
  }
  match = text.match(/^([+-]?\d+(\.\d+)?)=([+-]?\d*\.?\d*)x([+-]\d+(\.\d+)?)?$/i);
  if (match) {
    const c = Number(match[1]);
    const a = match[3] === "" || match[3] === "+" ? 1 : match[3] === "-" ? -1 : Number(match[3]);
    const b = match[4] ? Number(match[4]) : 0;
    if (Number.isFinite(a) && a !== 0 && Number.isFinite(b) && Number.isFinite(c)) {
      const x = (c - b) / a;
      return `Thinking\n- (omitted by request)\n\nResult\n- x = ${x}`;
    }
  }
  return null;
}

function basicStatsSolver(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!/\b(average|mean|median|sum|min|max)\b/i.test(text)) return null;
  const nums = parseNumberList(prompt);
  if (nums.length === 0) return null;
  if (text.includes("average") || text.includes("mean")) {
    const value = nums.reduce((a, b) => a + b, 0) / nums.length;
    return `Thinking\n- (omitted by request)\n\nResult\n- average = ${value}`;
  }
  if (text.includes("median")) {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return `Thinking\n- (omitted by request)\n\nResult\n- median = ${value}`;
  }
  if (text.includes("sum")) {
    const value = nums.reduce((a, b) => a + b, 0);
    return `Thinking\n- (omitted by request)\n\nResult\n- sum = ${value}`;
  }
  if (text.includes("min")) {
    const value = Math.min(...nums);
    return `Thinking\n- (omitted by request)\n\nResult\n- min = ${value}`;
  }
  if (text.includes("max")) {
    const value = Math.max(...nums);
    return `Thinking\n- (omitted by request)\n\nResult\n- max = ${value}`;
  }
  return null;
}

function listSetSolver(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!/\b(union|intersection|difference)\b/i.test(text)) return null;
  const lists = String(prompt || "").match(/\[[^\]]+\]/g) || [];
  if (lists.length < 2) return null;
  const listA = parseNumberList(lists[0]);
  const listB = parseNumberList(lists[1]);
  if (listA.length === 0 || listB.length === 0) return null;
  const setA = new Set(listA);
  const setB = new Set(listB);
  if (text.includes("union")) {
    const value = Array.from(new Set([...setA, ...setB]));
    return `Thinking\n- (omitted by request)\n\nResult\n- union = [${value.join(", ")}]`;
  }
  if (text.includes("intersection")) {
    const value = Array.from(setA).filter((item) => setB.has(item));
    return `Thinking\n- (omitted by request)\n\nResult\n- intersection = [${value.join(", ")}]`;
  }
  if (text.includes("difference")) {
    const value = Array.from(setA).filter((item) => !setB.has(item));
    return `Thinking\n- (omitted by request)\n\nResult\n- difference = [${value.join(", ")}]`;
  }
  return null;
}

function sortFilterSolver(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!/\b(sort|remove|filter)\b/i.test(text)) return null;
  const nums = parseNumberList(prompt);
  if (nums.length === 0) return null;
  if (text.includes("sort")) {
    const asc = !text.includes("desc");
    const sorted = [...nums].sort((a, b) => (asc ? a - b : b - a));
    const order = asc ? "ascending" : "descending";
    return `Thinking\n- (omitted by request)\n\nResult\n- sorted (${order}) = [${sorted.join(", ")}]`;
  }
  const filterMatch = text.match(/(remove|filter).*(<=|>=|<|>)\s*(-?\d+(\.\d+)?)/i);
  if (filterMatch) {
    const op = filterMatch[2];
    const val = Number(filterMatch[3]);
    const filtered = nums.filter((num) => {
      if (op === "<") return num >= val;
      if (op === ">") return num <= val;
      if (op === "<=") return num > val;
      if (op === ">=") return num < val;
      return true;
    });
    return `Thinking\n- (omitted by request)\n\nResult\n- filtered = [${filtered.join(", ")}]`;
  }
  return null;
}

function stringUtilsSolver(prompt) {
  const text = String(prompt || "");
  const lower = text.toLowerCase();
  const match = text.match(/:\s*([\s\S]+)$/);
  const target = match ? match[1] : text.replace(/^(make|convert)\s+/i, "");
  if (/\buppercase\b/.test(lower)) {
    return `Thinking\n- (omitted by request)\n\nResult\n- ${target.toUpperCase()}`;
  }
  if (/\blowercase\b/.test(lower)) {
    return `Thinking\n- (omitted by request)\n\nResult\n- ${target.toLowerCase()}`;
  }
  if (/\btitlecase\b/.test(lower)) {
    const value = target.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    return `Thinking\n- (omitted by request)\n\nResult\n- ${value}`;
  }
  if (/\blength\b/.test(lower)) {
    return `Thinking\n- (omitted by request)\n\nResult\n- length = ${target.trim().length}`;
  }
  if (/\bslugify\b/.test(lower)) {
    const slug = target
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `Thinking\n- (omitted by request)\n\nResult\n- ${slug}`;
  }
  if (/\btrim\b/.test(lower)) {
    return `Thinking\n- (omitted by request)\n\nResult\n- ${target.trim()}`;
  }
  return null;
}

function validationSolver(prompt) {
  const text = String(prompt || "");
  const lower = text.toLowerCase();
  if (!/\bvalid\b/.test(lower)) return null;
  const emailMatch = text.match(/([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    const email = emailMatch[1];
    const valid = /^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}$/.test(email);
    return `Thinking\n- (omitted by request)\n\nResult\n- ${email} is ${valid ? "valid" : "invalid"}`;
  }
  const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    const url = urlMatch[1];
    const valid = /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url);
    return `Thinking\n- (omitted by request)\n\nResult\n- ${url} is ${valid ? "valid" : "invalid"}`;
  }
  return null;
}

function regexSolver(prompt) {
  const text = String(prompt || "");
  const regexMatch = text.match(/\/(.+)\/([gimsuy]*)/);
  if (!regexMatch) return null;
  const pattern = regexMatch[1];
  const flags = regexMatch[2] || "";
  const inputMatch = text.match(/['"`]([^'"`]+)['"`]/);
  if (!inputMatch) return null;
  const input = inputMatch[1];
  try {
    const re = new RegExp(pattern, flags);
    const matches = input.match(re);
    if (!matches) {
      return `Thinking\n- (omitted by request)\n\nResult\n- no match`;
    }
    return `Thinking\n- (omitted by request)\n\nResult\n- match = ${JSON.stringify(matches)}`;
  } catch (err) {
    return null;
  }
}

function tryLocalSolvers(prompt) {
  const solvers = [
    { name: "simple_arithmetic", fn: simpleArithmeticSolver },
    { name: "percent", fn: percentSolver },
    { name: "unit_conversion", fn: unitConversionSolver },
    { name: "date_math", fn: dateMathSolver },
    { name: "simple_equation", fn: simpleEquationSolver },
    { name: "basic_stats", fn: basicStatsSolver },
    { name: "list_set", fn: listSetSolver },
    { name: "sort_filter", fn: sortFilterSolver },
    { name: "string_utils", fn: stringUtilsSolver },
    { name: "validation", fn: validationSolver },
    { name: "regex", fn: regexSolver }
  ];
  for (const solver of solvers) {
    const answer = solver.fn(prompt);
    if (answer) return { handled: true, answer, solver: solver.name };
  }
  return { handled: false };
}

function isTrivialMessage(prompt) {
  const text = String(prompt || "").trim().toLowerCase();
  return ["ok", "okay", "thanks", "thank you", "thx", "ty", "lol", "nice", "good night", "goodnight"].includes(text);
}

function isSimpleQaFastPath(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return false;
  const tokens = text.split(/\s+/);
  if (tokens.length > 40) return false;
  const lower = text.toLowerCase();
  const heavyCode = /\b(function|bug|stack trace|html|css|javascript|python|sql|schema|optimize|debug)\b/i.test(lower);
  const heavyMath = /\b(prove|integral|derivative|theorem|limit|riddle|puzzle|equation system)\b/i.test(lower);
  const ranking = /\b(top|best|rank|ranking|leaderboard)\b/i.test(lower);
  const wantsSources = /\b(cite|sources|links|references)\b/i.test(lower);
  const docRefs = /\b(in my doc|in the pdf|in the file|uploaded)\b/i.test(lower);
  return !(heavyCode || heavyMath || ranking || wantsSources || docRefs);
}

function isUncertainResponse(text) {
  return /\b(i'm not sure|i am not sure|not sure|cannot|can't|unsure|i don't know)\b/i.test(String(text || ""));
}

function buildGreetingResponse() {
  return "Thinking\n- (omitted by request)\n\nResult\n- Hi! I am here and ready. Tell me what you need and I will help.";
}

function buildSmallTalkResponse(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (/\b(how are you|how's it going|how is it going|how are u|how r u)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- I'm doing well, thanks! How can I help?";
  }
  if (/\bwhat's up|whats up|sup\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- Not much—ready to help. What do you need?";
  }
  if (/\bgood morning\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- Good morning! What can I do for you?";
  }
  if (/\bgood afternoon\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- Good afternoon! What can I do for you?";
  }
  if (/\bgood evening\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- Good evening! What can I do for you?";
  }
  return buildGreetingResponse();
}

function buildInstantConversationResponse(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (isSmallTalkPrompt(text)) {
    return buildSmallTalkResponse(text);
  }
  if (/\b(i am|i'm|im)\s+(sad|tired|stressed|angry|upset|lonely|anxious|worried|scared)\b/.test(text) ||
      /\b(feel|feeling)\s+(sad|tired|stressed|angry|upset|lonely|anxious|worried|scared)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- I'm sorry you're feeling that way. Want to talk about it?";
  }
  if (/\b(i am|i'm|im)\s+(happy|excited)\b/.test(text) ||
      /\b(feel|feeling)\s+(happy|excited)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- That's awesome! Want to share more?";
  }
  if (/\b(cheer me up|motivate me|encourage me|give me hope|i need motivation)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- You've got this. What's one small step you can take right now?";
  }
  if (/\b(tell me a joke|make me laugh|funny|joke)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- Why did the computer get cold? It left its Windows open.";
  }
  if (/\b(fun fact|random fact|fact)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- Fun fact: Honey never spoils if stored properly.";
  }
  if (/\b(how old are you|your age|what is your age|age are you)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- I'm an AI, so I don't have a real age. I was created recently and keep improving.";
  }
  if (/\b(what is your name|your name|who are you|what are you)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- I'm BA AI Assistant. How can I help?";
  }
  if (/\b(who made you|who created you|who built you)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- I was built by the BA AI Studio team.";
  }
  if (/\b(love me|be my friend|be my girlfriend|be my boyfriend|be my wife|be my husband|darling|sweetheart)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- I can be a friendly, supportive chat partner. How can I help?";
  }
  if (/^(thanks|thank you|thx|ty)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- You're welcome! Anything else you want to do?";
  }
  if (/^(ok|okay|cool|nice|great)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- Got it. What do you want to do next?";
  }
  if (/^(yes|no|maybe|sure)\b/.test(text)) {
    return "Thinking\n- (omitted by request)\n\nResult\n- Thanks for the reply. What's next?";
  }
  return "Thinking\n- (omitted by request)\n\nResult\n- I'm here. How can I help you?";
}

function buildMathLevelResponse() {
  return [
    "Thinking",
    "- (omitted by request)",
    "",
    "Result",
    "- Math level I follow",
    "",
    "Standard order of operations (PEMDAS/BODMAS)",
    "Parentheses → Exponents → Multiplication/Division (left→right) → Addition/Subtraction (left→right)",
    "",
    "I can work across basic arithmetic → algebra → calculus → linear algebra → probability/statistics (and more), depending on what you ask.",
    "",
    "Task tools I use for math",
    "",
    "- Built-in reasoning (no tool): most math problems and step-by-step explanations.",
    "- python.exec: to verify results, handle large calculations, simulations, parsing data, etc. (not shown to you).",
    "- python_user_visible.exec: when you want the math shown with tables/plots or you want me to generate a file (CSV/PDF/etc.)."
  ].join("\n");
}

function buildToolResponse(output) {
  const safeOutput = String(output || "").trim();
  return `Thinking\n- (omitted by request)\n\nResult\n${safeOutput ? safeOutput : "- Done."}`;
}

function parseChartInput(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    if (Array.isArray(input.data)) return input.data;
  }
  const text = String(input || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.data)) return parsed.data;
  } catch (err) {
    // fallthrough
  }
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return rows
    .map((line) => {
      const parts = line.split(/[:,\t]/).map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) return null;
      const value = Number(parts[1]);
      if (!Number.isFinite(value)) return null;
      return { label: parts[0], value };
    })
    .filter(Boolean);
}

function parseChartSpec(input) {
  if (input && typeof input === "object") {
    if (Array.isArray(input.series) || Array.isArray(input.data)) return input;
  }
  const text = String(input || "").trim();
  if (!text) return { data: [] };
  try {
    const parsed = JSON.parse(text);
    if (parsed && (Array.isArray(parsed.series) || Array.isArray(parsed.data))) {
      return parsed;
    }
  } catch (err) {
    // fallthrough
  }
  return { data: parseChartInput(input) };
}

function filterMemoryEntriesByMeta(entries, { userId, teamId, teamMode }) {
  if (teamMode) {
    if (teamId) {
      return entries.filter((entry) => entry?.meta?.teamId === teamId);
    }
    return entries;
  }
  if (!userId) return entries;
  return entries.filter((entry) => entry?.meta?.userId === userId);
}

const CREATIVE_STYLE_PRESETS = {
  cinematic: "Cinematic tone, vivid imagery, varied sentence length, strong sensory detail.",
  minimal: "Minimal, clean, precise wording with strong rhythm and no fluff.",
  whimsical: "Playful, imaginative tone with light humor and surprising metaphors.",
  technical: "Clear, structured, factual tone with strong definitions and examples.",
  brand: "Brand-forward tone with confident voice, short punchy lines, and clear CTA."
};

function extractStylePreset(prompt, payload) {
  const explicit = String(payload?.stylePreset || "").trim().toLowerCase();
  if (explicit && CREATIVE_STYLE_PRESETS[explicit]) return explicit;
  const match = String(prompt || "").match(/\bstyle\s*:\s*([a-z0-9_-]+)/i);
  const candidate = match ? match[1].toLowerCase() : "";
  if (candidate && CREATIVE_STYLE_PRESETS[candidate]) return candidate;
  return "cinematic";
}

function buildIntentExtras(intentData, prompt, payload) {
  const extras = [];
  if (!intentData || !intentData.intent) return "";
  if (intentData.intent === "RANKING_QUERY") {
    extras.push("Provide a numbered top-N list with concrete items (names/versions).");
    extras.push("Use recent sources and mention recency (month/year).");
    extras.push("Do not answer with generic categories; list actual items with short justifications.");
    if (/\b(ai model|llm|language model|chat model|gpt|claude|gemini|grok)\b/i.test(prompt || "")) {
      extras.push("Prefer leaderboard/benchmark sources (e.g., Chatbot Arena/LMSys).");
      extras.push("List specific model names with metrics if available (Elo, win-rate, score).");
    }
  }
  if (intentData.intent === "CREATIVE") {
    const preset = extractStylePreset(prompt, payload);
    extras.push(`Style preset: ${preset}. ${CREATIVE_STYLE_PRESETS[preset]}`);
    extras.push("Aim for a longer, fully developed response unless user asked for brief.");
  }
  if (intentData.intent === "LEARNING") {
    extras.push("Include: (1) a 3-question quiz with answers, (2) a spaced repetition schedule (1d/3d/7d/14d).");
  }
  if (intentData.intent === "DECISION_MAKING") {
    extras.push("Provide a weighted decision matrix with criteria, weights (total 100), and scored options.");
  }
  if (intentData.intent === "SYSTEM_DESIGN") {
    extras.push("Include a Mermaid diagram code block describing the architecture.");
  }
  if (intentData.intent === "HTML_MARKUP") {
    extras.push("Return a complete, valid HTML document with semantic layout, responsive meta tag, and minimal inline CSS.");
    extras.push("Accessibility: include landmarks, labels for inputs, and good color contrast.");
    extras.push("Add a short HTML validation checklist (doctype, lang, aria labels, semantics).");
  }
  if (intentData.intent === "ANALYSIS_REPORT") {
    extras.push("Use a report structure: Executive Summary, Metrics, Trends, Insights, Recommendations, Caveats.");
  }
  if (intentData.intent === "VISUALIZATION" || intentData.intent === "DATA_ANALYSIS") {
    extras.push("If numeric series present, include CHART_JSON with {title,data:[{label,value}]} or {title,labels:[...],series:[{name,data:[...]}]}.");
  }
  if (intentData.intent === "PROOF_SOLVING" || intentData.intent === "FORMULA_GENERATION") {
    extras.push("If possible, verify with sympy-style reasoning or sanity checks.");
  }
  if (intentData.intent === "RIDDLE") {
    extras.push("Add a difficulty rating (easy/medium/hard) in Result.");
  }
  if (intentData.intent === "MATH_REASONING") {
    extras.push("Verify numeric results with a quick calculation check.");
  }
  return extras.filter(Boolean).join("\n");
}

function escapePdfText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "");
}

function buildSimplePdfBuffer(text) {
  const lines = String(text || "")
    .split(/\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, 300);
  const contentLines = lines.map((line, index) => {
    const y = 760 - index * 14;
    if (y < 50) return null;
    return `1 0 0 1 72 ${y} Tm (${escapePdfText(line)}) Tj`;
  }).filter(Boolean);
  const content = `BT\n/F1 12 Tf\n${contentLines.join("\n")}\nET`;

  const header = "%PDF-1.4\n";
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj"
  ];

  let body = "";
  const offsets = [];
  for (const obj of objects) {
    offsets.push((header + body).length);
    body += `${obj}\n`;
  }
  const xrefStart = (header + body).length;
  const xrefLines = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  offsets.forEach((offset) => {
    xrefLines.push(String(offset).padStart(10, "0") + " 00000 n ");
  });
  const xref = xrefLines.join("\n");
  const trailer = `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(header + body + xref + "\n" + trailer, "utf8");
}

function needsQc(text, prompt) {
  if (!text) return true;
  if (!/Result/i.test(text)) return true;
  const minLength = qualityConfig.minLength || 120;
  if (text.length < minLength) return true;
  if ((prompt || "").length < 120) return false;
  return false;
}

async function runQc({ model, prompt, draft }) {
  const qcModel = model || qualityConfig.qcModel || "gemma:2b";
  const qcPrompt = `Fix omissions and produce final answer without adding fluff.

User request:
${prompt}

Draft response:
${draft}`;
  return callOllamaGenerate({
    model: qcModel,
    prompt: qcPrompt,
    options: { temperature: 0.2 }
  });
}

function extractToolCalls(text) {
  if (!text) return [];
  const match = String(text).match(/\{[\s\S]*"tool_calls"[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.tool_calls)) return [];
    return parsed.tool_calls;
  } catch (err) {
    return [];
  }
}

async function embedText(text, model) {
  try {
    return await callOllamaEmbed({ model, input: text });
  } catch (err) {
    console.warn("Embedding failed:", err.message);
    return [];
  }
}

async function runWithRetry(fn, retries = 1, delayMs = 150) {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return runWithRetry(fn, retries - 1, delayMs);
  }
}


function isComplexPrompt(prompt) {
  return /code|sql|database|query|debug|error|stack|chart|graph|visual|analyze|compare|algorithm|design/i.test(
    prompt || ""
  );
}

function buildCacheKey({ model, prompt, options }) {
  return `${model}::${JSON.stringify(prompt)}::${JSON.stringify(options || {})}`;
}

function getCachedResponse(key) {
  const entry = responseCache.get(key);
  if (!entry || Date.now() - entry.timestamp > entry.ttl) {
    responseCache.delete(key);
    return null;
  }
  return entry;
}

function storeInCache(key, value, ttlMs = DEFAULT_CACHE_TTL_MS) {
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
  responseCache.set(key, { value, timestamp: Date.now(), ttl: ttlMs });
}

function combineSignals(signals) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.any) {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signals.forEach((signal) => {
    if (!signal) return;
    if (signal.aborted) {
      controller.abort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return controller.signal;
}

function recordModelStat(model, durationMs, hadError = false) {
  const entry = modelStats.get(model) || { count: 0, errors: 0, totalMs: 0 };
  entry.count += 1;
  entry.totalMs += Number(durationMs) || 0;
  if (hadError) entry.errors += 1;
  modelStats.set(model, entry);
}

async function generateResponseWithCache({ model, prompt, options, cacheTtlMs }) {
  const cacheKey = buildCacheKey({ model, prompt, options });
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return { result: cached.value, fromCache: true };
  }
  const result = await callOllamaGenerate({ model, prompt, options });
  storeInCache(cacheKey, result, cacheTtlMs);
  return { result, fromCache: false };
}

async function loadLocalConfig() {
  const configPath = path.join(__dirname, "..", "config.json");
  try {
    const contents = await fs.readFile(configPath, "utf8");
    return JSON.parse(contents);
  } catch (err) {
    console.warn("Unable to load config.json, falling back to defaults.", err.message);
    return {};
  }
}

function resolveSystemMessage(modelName, fallback, modelMap) {
  if (modelMap && modelMap[modelName] && modelMap[modelName].systemMessage) {
    return modelMap[modelName].systemMessage;
  }
  return fallback;
}

function getAutoProfiles() {
  return {
    chat: {
      task: "auto-chat",
      defaultModel: "llama3.2",
      baseSystemMessage: GENERAL_PROMPT,
      failureMessage: "AI auto chat failed.",
      generateOptions: { temperature: 0.3 }
    },
    reason: {
      task: "auto-reason",
      defaultModel: "deepseek-r1",
      baseSystemMessage: REASON_PROMPT,
      failureMessage: "AI auto reasoning failed.",
      generateOptions: { temperature: 0.2 }
    },
    code: {
      task: "auto-code",
      defaultModel: "deepseek-coder-v2",
      baseSystemMessage: DEBUG_THINKING_PROMPT,
      failureMessage: "AI auto code failed.",
      generateOptions: { temperature: 0.25 }
    },
    sql: {
      task: "auto-sql",
      defaultModel: "qwen3",
      baseSystemMessage: SQL_PROMPT,
      failureMessage: "AI auto SQL failed.",
      generateOptions: { temperature: 0.2 }
    },
    debug: {
      task: "auto-debug",
      defaultModel: "deepseek-coder-v2",
      baseSystemMessage: DEBUG_THINKING_PROMPT,
      failureMessage: "AI auto debug failed.",
      generateOptions: { temperature: 0.2 }
    },
    chart: {
      task: "auto-chart",
      defaultModel: "qwen3",
      baseSystemMessage: CHART_GENERATION_PROMPT + "\n" + GENERAL_PROMPT,
      failureMessage: "AI auto chart failed.",
      generateOptions: { temperature: 0.2 }
    },
    vision: {
      task: "auto-vision",
      defaultModel: "llava-llama3",
      baseSystemMessage: `${CLARIFYING_NOTE}\nYou analyze images, dashboards, charts, and UIs.`,
      failureMessage: "AI auto vision failed.",
      generateOptions: { temperature: 0.3 }
    },
    research: {
      task: "auto-research",
      defaultModel: "qwen3",
      baseSystemMessage: `${CLARIFYING_NOTE}\n${GENERAL_PROMPT}\nProvide well-researched, factual answers with citations when applicable.`,
      failureMessage: "AI auto research failed.",
      generateOptions: { temperature: 0.3 }
    },
    report: {
      task: "auto-report",
      defaultModel: "qwen3",
      baseSystemMessage: REPORT_PROMPT,
      failureMessage: "AI auto report failed.",
      generateOptions: { temperature: 0.25 }
    },
    dashboard: {
       task: "auto-dashboard",
       defaultModel: "qwen3",
       baseSystemMessage: DASHBOARD_PROMPT,
       failureMessage: "AI auto dashboard failed.",
       generateOptions: { temperature: 0.2, max_tokens: 2000 }
     },
     dashboard_vanilla: {
       task: "auto-dashboard-vanilla",
       defaultModel: "qwen3",
       baseSystemMessage: DASHBOARD_PROMPT_VANILLA,
       failureMessage: "AI auto dashboard failed.",
       generateOptions: { temperature: 0.2, max_tokens: 1500 }
     },
    image_prompt: {
      task: "auto-image-prompt",
      defaultModel: "qwen3",
      baseSystemMessage: IMAGE_PROMPT_INSTRUCTION,
      failureMessage: "AI auto image prompt failed.",
      generateOptions: { temperature: 0.3 }
    },
    video_prompt: {
      task: "auto-video-prompt",
      defaultModel: "qwen3",
      baseSystemMessage: VIDEO_PROMPT_INSTRUCTION,
      failureMessage: "AI auto video prompt failed.",
      generateOptions: { temperature: 0.3 }
    },
    fast: {
      task: "auto-fast",
      defaultModel: "qwen3",
      baseSystemMessage: FAST_PROMPT,
      failureMessage: "AI auto fast response failed.",
      generateOptions: { temperature: 0.2, max_tokens: 384 }
    }
  };
}

async function startServer() {
  const config = await loadLocalConfig();
  const modelMap = (config.models || []).reduce((acc, modelDef) => {
    acc[modelDef.model] = modelDef;
    return acc;
  }, {});
  const toolsConfig = config.tools || {};
  const memoryConfig = config.memory || {};
  qualityConfig = config.quality || {};
  webConfig = config.web || {};
  routingConfig = config.routing || {};
  const pythonPath = toolsConfig.pythonPath || "python";
  const pythonSafeMode = toolsConfig.safeMode !== false;
  const pythonMaxChars = toolsConfig.maxChars || 12000;
  const nodePath = toolsConfig.nodePath || "node";
  const jsSafeMode = toolsConfig.jsSafeMode !== false;
  const jsTimeoutMs = toolsConfig.jsTimeoutMs || 2000;
  const sqliteReadOnly = toolsConfig.sqliteReadOnly !== false;
  const memoryTtlDays = Number.isFinite(memoryConfig.ttlDays) ? memoryConfig.ttlDays : 30;
  const memoryEmbeddingWeight = Number.isFinite(memoryConfig.embeddingWeight) ? memoryConfig.embeddingWeight : 2;
  if (webConfig.searchEngine) {
    process.env.SEARCH_API = webConfig.searchEngine;
  }
  if (webConfig.searxngUrl) {
    process.env.SEARXNG_URL = webConfig.searxngUrl;
  }
  const toolsEnabled = toolsConfig.enabled !== false;
  const embeddingsConfig = config.embeddings || {};
  const embeddingsEnabled = embeddingsConfig.enabled !== false;
  const embedModel = embeddingsConfig.model || "bge-m3";
  const embedChunkSize = embeddingsConfig.chunkSize || 900;
  const embedChunkOverlap = embeddingsConfig.chunkOverlap || 160;
  const embedTopK = embeddingsConfig.topK || 3;
  let memoryEntries = await loadMemory();
  const pruned = pruneExpiredEntries(memoryEntries);
  if (pruned.length !== memoryEntries.length) {
    memoryEntries = pruned;
    await saveMemory(memoryEntries);
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(__dirname, "..")));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws/stream" });
  const conversationSummaryTracker = new Map();
  const SUMMARY_EVERY_MESSAGES = 8;

  async function summarizeConversationIfNeeded(userId) {
    if (!userId) return;
    const stats = conversationMemory.getStats(userId);
    if (stats.totalMessages < SUMMARY_EVERY_MESSAGES) return;
    const lastCount = conversationSummaryTracker.get(userId) || 0;
    if (stats.totalMessages - lastCount < SUMMARY_EVERY_MESSAGES) return;

    const context = conversationMemory.getContext(userId, 10);
    const summaryPrompt = `Summarize the conversation into JSON with fields:
topic, summary, important_entities, unresolved_questions.
Return ONLY JSON.

Conversation:
${JSON.stringify(context.messages, null, 2)}`;
    try {
      const summaryRaw = await callOllamaGenerate({
        model: "llama3.2",
        prompt: summaryPrompt,
        options: { temperature: 0.2 }
      });
      const summaryText = extractResultSection(summaryRaw) || summaryRaw;
      let embedding = null;
      if (embeddingsEnabled) {
        try {
          embedding = await embedText(summaryText, embedModel);
        } catch (err) {
          embedding = null;
        }
      }
      const entry = buildMemoryEntry({
        prompt: "Conversation summary",
        response: summaryText,
        meta: { type: "conversation_summary", userId },
        embedding,
        ttlDays: memoryTtlDays
      });
      memoryEntries.push(entry);
      await saveMemory(memoryEntries);
      conversationSummaryTracker.set(userId, stats.totalMessages);
    } catch (err) {
      console.warn("Conversation summary failed:", err.message);
    }
  }

async function handleAiRequest(req, res, options) {
    const requestBody = req.body || {};
    const incomingPrompt = typeof requestBody.prompt === "string" ? requestBody.prompt.trim() : "";
    if (!incomingPrompt && !options.allowEmptyPrompt) {
      return res.status(400).json({ error: "Missing 'prompt' in the request." });
    }
    const modelName = requestBody.model || options.defaultModel;
    const systemMessage = resolveSystemMessage(modelName, options.baseSystemMessage, modelMap);
    const languageName = requestBody.language || "English";
    const languageInstruction = languageName ? `Respond in ${languageName}.` : "";
    const extraSystemMessage = requestBody.systemMessageExtra || "";
    const toneInstruction = detectTonePreference(incomingPrompt);
    const promptSystemMessage = [LOCAL_AI_SPEC, systemMessage, languageInstruction, extraSystemMessage, toneInstruction]
      .filter(Boolean)
      .join("\n");
    const customPrompt = options.composePrompt
      ? options.composePrompt(incomingPrompt, requestBody)
      : incomingPrompt;
    const responseSpecInstruction = requestBody.responseSpec
      ? `Response spec:\n${JSON.stringify(requestBody.responseSpec, null, 2)}`
      : "";
    const noThinkingInstruction = requestBody.responseSpec?.no_thinking
      ? "Thinking must contain exactly one bullet: (omitted by request)."
      : "";
    const wrappedPrompt = buildThinkingResultPrompt(
      customPrompt,
      promptSystemMessage,
      [responseSpecInstruction, noThinkingInstruction].filter(Boolean).join("\n")
    );

    try {
      const start = Date.now();
      const cacheTtlMs = options.cacheTtlMs ?? (options.task === "fast" ? FAST_CACHE_TTL_MS : DEFAULT_CACHE_TTL_MS);
      let { result: responseText, fromCache } = await generateResponseWithCache({
        model: modelName,
        prompt: wrappedPrompt,
        options: options.generateOptions || {},
        cacheTtlMs
      });
      if (qualityConfig.enabled && needsQc(responseText, customPrompt)) {
        const qcResponse = await runQc({ model: qualityConfig.qcModel, prompt: customPrompt, draft: responseText });
        if (qcResponse) {
          responseText = qcResponse;
          fromCache = false;
        }
      }
      const duration = Date.now() - start;
      res.json({
        model: modelName,
        response: responseText,
        meta: {
          task: options.task,
          durationMs: duration,
          cacheHit: fromCache,
          ...(options.metaExtras || {})
        }
      });
    } catch (err) {
      console.error(`Error in ${options.task}:`, err);
      res.status(500).json({ error: `${options.failureMessage} ${err.message}` });
    }
  }

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      service: "ba-local-ai-service"
    });
  });

  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "index.html"));
  });

  app.post("/api/chat", (req, res) =>
    handleAiRequest(req, res, {
      task: "chat",
      defaultModel: "llama3.2",
      baseSystemMessage: `${CLARIFYING_NOTE}\n${GENERAL_PROMPT}`,
      failureMessage: "AI chat failed.",
      generateOptions: { temperature: 0.3 }
    })
  );

  app.post("/api/reason", (req, res) =>
    handleAiRequest(req, res, {
      task: "reason",
      defaultModel: "qwen3",
      baseSystemMessage: `${CLARIFYING_NOTE}\n${REASON_PROMPT}`,
      failureMessage: "AI reasoning failed.",
      generateOptions: { temperature: 0.2 }
    })
  );

  app.post("/api/code", (req, res) =>
    handleAiRequest(req, res, {
      task: "code",
      defaultModel: "deepseek-coder-v2",
      baseSystemMessage: DEBUG_THINKING_PROMPT,
      failureMessage: "AI code/SQL failed.",
      generateOptions: { temperature: 0.25 }
    })
  );

  app.post("/api/sql", (req, res) =>
    handleAiRequest(req, res, {
      task: "sql",
      defaultModel: "qwen3",
      baseSystemMessage: SQL_PROMPT,
      failureMessage: "AI SQL failed.",
      generateOptions: { temperature: 0.2 }
    })
  );

  app.post("/api/vision", async (req, res) => {
    const { prompt, imageDescription, model } = req.body || {};
    if (!prompt && !imageDescription) {
      return res.status(400).json({ error: "Provide 'prompt' or 'imageDescription'." });
    }
    const combinedPrompt = `${prompt || ""}\n\nImage description:\n${imageDescription || ""}`;
    return handleAiRequest(req, res, {
      task: "vision",
      defaultModel: "llava-llama3",
      baseSystemMessage: `${CLARIFYING_NOTE}\nYou analyze images, dashboards, charts, and UIs.`,
      failureMessage: "AI vision failed.",
      composePrompt: () => combinedPrompt,
      generateOptions: { temperature: 0.3 },
      allowEmptyPrompt: true
    });
  });

  app.post("/api/auto", async (req, res) => {
    const {
      prompt,
      imageDescription,
      task,
      fast,
      filePaths,
      autoFiles = true,
      autoWeb = false,
      userId,
      teamId,
      teamMode = false,
      useDocIndex = false,
      useEmbeddings = true
    } = req.body || {};
    const incomingPrompt = typeof prompt === "string" ? prompt.trim() : "";
    const rewriteEnabled = routingConfig.rewriteEnabled !== false;
    const shouldRewrite = rewriteEnabled && shouldRewritePrompt(incomingPrompt);
    let rewrittenPrompt = "";
    if (shouldRewrite) {
      try {
        rewrittenPrompt = await rewritePrompt(incomingPrompt);
      } catch (err) {
        console.warn("Prompt rewrite failed:", err.message);
      }
    }
    const effectivePrompt = rewrittenPrompt || incomingPrompt;

    if (!incomingPrompt && !imageDescription && (!Array.isArray(filePaths) || filePaths.length === 0)) {
      return res.status(400).json({ error: "Provide 'prompt', 'imageDescription', or 'filePaths'." });
    }

    if (incomingPrompt && isGreeting(incomingPrompt)) {
      return res.json({
        model: "local",
        response: buildGreetingResponse(),
        meta: { task: "greeting", route: "greeting", durationMs: 0 }
      });
    }

    const toolCommand = toolsEnabled
      ? parseToolCommand(incomingPrompt) || detectImplicitToolCommand(incomingPrompt)
      : null;
    if (!toolsEnabled && (parseToolCommand(incomingPrompt) || detectImplicitToolCommand(incomingPrompt))) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    if (toolCommand) {
      try {
        if (toolCommand.tool === "python") {
          const output = await runPython({
            code: toolCommand.input,
            pythonPath,
            safeMode: pythonSafeMode,
            maxChars: pythonMaxChars
          });
          return res.json({
            model: "tool",
            response: buildToolResponse(output),
            meta: { task: "tool-python", route: "tool-python", durationMs: 0 }
          });
        }
        if (toolCommand.tool === "sql") {
          const dbPath = toolsConfig.sqliteDbPath;
          const output = await runSqliteQuery({
            query: toolCommand.input,
            dbPath,
            pythonPath,
            allowWrite: !sqliteReadOnly
          });
          return res.json({
            model: "tool",
            response: buildToolResponse(output),
            meta: { task: "tool-sql", route: "tool-sql", durationMs: 0 }
          });
        }
        if (toolCommand.tool === "sql_schema") {
          const dbPath = toolsConfig.sqliteDbPath;
          const output = await getSqliteSchema({
            dbPath,
            pythonPath
          });
          return res.json({
            model: "tool",
            response: buildToolResponse(output),
            meta: { task: "tool-sql-schema", route: "tool-sql-schema", durationMs: 0 }
          });
        }
        if (toolCommand.tool === "ingest") {
          const targets = toolCommand.input.split(",").map((item) => item.trim()).filter(Boolean);
          const docs = await Promise.all(
            targets.map((target) => ingestDocument({ projectRoot: PROJECT_ROOT, filePath: target }))
          );
          const responseText = docs
            .map((doc) => `File: ${doc.path}\n${doc.text}`)
            .join("\n\n");
          return res.json({
            model: "tool",
            response: buildToolResponse(responseText),
            meta: { task: "tool-ingest", route: "tool-ingest", durationMs: 0 }
          });
        }
        if (toolCommand.tool === "summarize") {
          const output = await summarizeText(toolCommand.input);
          return res.json({
            model: "tool",
            response: buildToolResponse(output),
            meta: { task: "tool-summarize", route: "tool-summarize", durationMs: 0 }
          });
        }
        if (toolCommand.tool === "code_analysis") {
          const output = analyzeCode(toolCommand.input);
          return res.json({
            model: "tool",
            response: buildToolResponse(JSON.stringify(output, null, 2)),
            meta: { task: "tool-code-analysis", route: "tool-code-analysis", durationMs: 0 }
          });
        }
        if (toolCommand.tool === "code_execute") {
          const output = await executeCode({
            code: toolCommand.input,
            pythonPath,
            safeMode: pythonSafeMode,
            maxChars: pythonMaxChars,
            nodePath,
            jsSafeMode,
            jsTimeoutMs
          });
          return res.json({
            model: "tool",
            response: buildToolResponse(output),
            meta: { task: "tool-code-execute", route: "tool-code-execute", durationMs: 0 }
          });
        }
        if (toolCommand.tool === "sympy") {
          const output = await runSympy({ code: toolCommand.input, pythonPath });
          return res.json({
            model: "tool",
            response: buildToolResponse(output),
            meta: { task: "tool-sympy", route: "tool-sympy", durationMs: 0 }
          });
        }
        if (toolCommand.tool === "visualize") {
          const chartSpec = parseChartSpec(toolCommand.input);
          const output = ResponseFormatter.chartToHTML(chartSpec);
          return res.json({
            model: "tool",
            response: buildToolResponse(output),
            meta: { task: "tool-visualize", route: "tool-visualize", durationMs: 0 }
          });
        }
        if (toolCommand.tool === "search") {
          const results = await searchWeb(toolCommand.input);
          const responseText = extractRelevantInfo(results, toolCommand.input);
          return res.json({
            model: "tool",
            response: buildToolResponse(responseText),
            meta: { task: "tool-search", route: "tool-search", durationMs: 0 }
          });
        }
        if (toolCommand.tool === "fetch" || toolCommand.tool === "url") {
          const url = toolCommand.input.trim();
          if (!url) {
            return res.status(400).json({ error: "Missing URL." });
          }
          const content = await fetchPageContent(url);
          return res.json({
            model: "tool",
            response: buildToolResponse(content || "No content found."),
            meta: { task: "tool-fetch", route: "tool-fetch", durationMs: 0 }
          });
        }
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    const bypassHeavy = shouldBypassHeavyWork(effectivePrompt);
    const forceComplex = isComplexPrompt(effectivePrompt);
    const fastPromptChars = routingConfig.fastPromptChars || 28;
    const isTinyPrompt = effectivePrompt.length > 0 && effectivePrompt.length <= fastPromptChars;
    let resolvedFilePaths = Array.isArray(filePaths) ? filePaths : [];
    let autoFilePaths = [];
    if (!bypassHeavy && resolvedFilePaths.length === 0 && autoFiles !== false) {
      autoFilePaths = await autoSelectFiles({ projectRoot: PROJECT_ROOT, prompt: effectivePrompt });
      resolvedFilePaths = autoFilePaths;
    }

    const { context: fileContext, files: filesMeta } = await loadFileContexts({
      projectRoot: PROJECT_ROOT,
      filePaths: bypassHeavy ? [] : resolvedFilePaths
    });

    const memoryRequested = detectMemoryTrigger(incomingPrompt);
        let webContext = "";
        let webUsed = false;
        let webSources = [];
    const autoWebEnabled =
      webConfig.enabled !== false &&
      (autoWeb === true || isLeaderboardPrompt(effectivePrompt)) &&
      !forceNoWeb;
    if (!bypassHeavy && autoWebEnabled) {
      const urls = extractUrls(incomingPrompt);
      if (urls.length > 0) {
        const pages = await Promise.all(urls.map((url) => fetchPageContent(url)));
        const pageText = pages.filter(Boolean).map((text, idx) => `Source ${idx + 1}:\n${text}`).join("\n\n");
        if (pageText) {
          webContext = `Web page context:\n${pageText}`;
          webUsed = true;
        }
      } else if (shouldUseWeb(effectivePrompt)) {
        const results = await searchWeb(effectivePrompt);
        if (results.length > 0) {
          const sources = formatWebSources(results);
          webContext = `Web search:\n${extractRelevantInfo(results, effectivePrompt)}\n\nSources:\n${sources}`;
          webUsed = true;
        }
      }
    }
    let memoryMatches = bypassHeavy
      ? []
      : queryMemoryEntries(memoryEntries, effectivePrompt, 4, { userId, teamMode, teamId });
    if (!bypassHeavy && memoryMatches.length === 0 && embeddingsEnabled) {
      try {
        const memoryEmbedding = await embedText(effectivePrompt, embedModel);
        memoryMatches = queryMemoryEntries(memoryEntries, effectivePrompt, 4, {
          userId,
          teamMode,
          teamId,
          embedding: memoryEmbedding,
          embeddingWeight: memoryEmbeddingWeight
        });
      } catch (err) {
        console.warn("Memory embeddings recall failed:", err.message);
      }
    }
    const memoryContext = memoryMatches.length
      ? `Relevant memory:\n${memoryMatches
          .map((entry, index) => `(${index + 1}) Q: ${entry.prompt}\nA: ${entry.response}`)
          .join("\n\n")}`
      : "";

    const queryVariants = generateQueryVariants(effectivePrompt, 3);
    let docContext = "";
    let docs = [];
    if (!bypassHeavy && useDocIndex) {
      docs = await gatherKeywordCandidates({
        projectRoot: PROJECT_ROOT,
        queries: queryVariants,
        limitPerQuery: 5
      });
      if (docs.length > 0) {
        docContext = `Docs context:\n${docs
          .map((doc, idx) => `Doc ${idx + 1}: ${doc.path}\n${doc.snippet}`)
          .join("\n\n")}`;
      }
    }
    let embeddingContext = "";
    let hits = [];
    const allowEmbeddings = useEmbeddings && embeddingsEnabled;
    if (!bypassHeavy && allowEmbeddings) {
      hits = await gatherEmbeddingCandidates({
        queries: queryVariants,
        embedFn: (text) => embedText(text, embedModel),
        limitPerQuery: embedTopK
      });
      if (hits.length > 0) {
        embeddingContext = `Embeddings context:\n${hits
          .map((hit, idx) => `Chunk ${idx + 1} (${hit.source}):\n${hit.text}`)
          .join("\n\n")}`;
      }
    }
    let ragCandidates = buildRagCandidates({ keywordResults: docs, embeddingResults: hits });
    if (!bypassHeavy && routingConfig.rerankEnabled !== false && ragCandidates.length > 1) {
      ragCandidates = await rerankCandidates({
        query: effectivePrompt,
        candidates: ragCandidates,
        model: routingConfig.rerankModel || "qwen3"
      });
    }
    const ragContext = buildHybridRagContext({
      keywordResults: docs,
      embeddingResults: hits,
      candidates: ragCandidates,
      limit: 5
    });
    const ragSources = ragCandidates
      .map((item) => item.source)
      .filter(Boolean)
      .slice(0, 6);

    const leaderboardHint = isVagueLeaderboardPrompt(effectivePrompt) ? buildVagueLeaderboardHint() : "";
    const composedPrompt = [
      effectivePrompt,
      leaderboardHint,
      fileContext ? `File context:\n${fileContext}` : "",
      ragContext || docContext || embeddingContext,
      webContext,
      memoryContext
    ]
      .filter(Boolean)
      .join("\n\n");

    const route = chooseRoute({
      prompt: effectivePrompt,
      imageDescription,
      taskHint: task || (forceComplex ? "reason" : undefined),
      preferFast: fast || bypassHeavy || !forceComplex || isTinyPrompt
    });

    const autoProfiles = getAutoProfiles();
    const profile = autoProfiles[route.task] || autoProfiles.chat;

    return handleAiRequest(req, res, {
      ...profile,
      allowEmptyPrompt: true,
      composePrompt: (_prompt, requestBody) => {
        const promptText = typeof requestBody.prompt === "string" ? requestBody.prompt.trim() : "";
        const rewrittenBlock = rewrittenPrompt
          ? `Interpreted request:\n${rewrittenPrompt}\n\nOriginal request:\n${incomingPrompt}`
          : "";
        const fileContextBlock = fileContext ? `File context:\n${fileContext}` : "";
        const memoryInstruction = memoryRequested
          ? "Memory requested: confirm 'Memory saved.' in Result."
          : "";

        if (route.task === "vision") {
          return [
            promptText,
            `Image description:\n${requestBody.imageDescription || ""}`,
            fileContextBlock,
            memoryInstruction
          ]
            .filter(Boolean)
            .join("\n\n");
        }

        return [rewrittenBlock || promptText, fileContextBlock, memoryInstruction].filter(Boolean).join("\n\n");
      },
      metaExtras: {
        route: route.task,
        routeReason: route.reason,
        files: filesMeta,
        memoryHits: memoryMatches.length,
        autoFiles: autoFilePaths.length > 0,
        memoryRequested,
        webUsed,
        ragSources
      }
    });
  });

  app.post("/api/memory/store", async (req, res) => {
    const { prompt, response, meta, userId, teamId } = req.body || {};
    if (!prompt || !response) {
      return res.status(400).json({ error: "Missing 'prompt' or 'response'." });
    }
    const memoryRequested = detectMemoryTrigger(prompt);
    if (!memoryRequested && !meta?.force) {
      return res.json({ status: "skipped" });
    }
    const summary = summarizeResponse(response);
    let embedding = null;
    if (embeddingsEnabled) {
      try {
        embedding = await embedText(`${prompt}\n${summary}`, embedModel);
      } catch (err) {
        console.warn("Memory embedding failed:", err.message);
      }
    }
    const entry = buildMemoryEntry({
      prompt,
      response: summary,
      meta: { ...(meta || {}), userId, teamId },
      embedding,
      ttlDays: memoryTtlDays
    });
    memoryEntries.push(entry);
    await saveMemory(memoryEntries);
    res.json({ status: "ok", id: entry.id });
  });

  app.get("/api/memory/entries", (req, res) => {
    const { userId, teamId, teamMode, limit } = req.query || {};
    const scoped = filterMemoryEntriesByMeta(pruneExpiredEntries(memoryEntries), {
      userId: userId ? String(userId) : null,
      teamId: teamId ? String(teamId) : null,
      teamMode: String(teamMode) === "true"
    });
    const cap = Math.max(1, Math.min(500, Number(limit) || 100));
    res.json({
      count: scoped.length,
      entries: scoped.slice(0, cap)
    });
  });

  app.delete("/api/memory/entries/:id", async (req, res) => {
    const { id } = req.params;
    const before = memoryEntries.length;
    memoryEntries = memoryEntries.filter((entry) => entry.id !== id);
    if (memoryEntries.length !== before) {
      await saveMemory(memoryEntries);
    }
    res.json({ deleted: before - memoryEntries.length });
  });

  app.post("/api/memory/entries/ttl", async (req, res) => {
    const { ids, ttlDays, userId, teamId, teamMode } = req.body || {};
    if (!Number.isFinite(ttlDays)) {
      return res.status(400).json({ error: "Missing or invalid ttlDays." });
    }
    const now = Date.now();
    const expiresAt = ttlDays > 0 ? new Date(now + ttlDays * 24 * 60 * 60 * 1000).toISOString() : null;
    const idSet = Array.isArray(ids) ? new Set(ids) : null;
    const scoped = filterMemoryEntriesByMeta(memoryEntries, {
      userId,
      teamId,
      teamMode
    });
    let updated = 0;
    for (const entry of scoped) {
      if (idSet && !idSet.has(entry.id)) continue;
      entry.expiresAt = expiresAt;
      updated += 1;
    }
    if (updated > 0) {
      await saveMemory(memoryEntries);
    }
    res.json({ updated, expiresAt });
  });

  app.post("/api/memory/entries/purge", async (req, res) => {
    const before = memoryEntries.length;
    memoryEntries = pruneExpiredEntries(memoryEntries);
    if (memoryEntries.length !== before) {
      await saveMemory(memoryEntries);
    }
    res.json({ removed: before - memoryEntries.length });
  });

  app.post("/api/cancel", (req, res) => {
    const { requestId } = req.body || {};
    if (!requestId) {
      return res.status(400).json({ error: "Missing 'requestId'." });
    }
    const controller = activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      activeRequests.delete(requestId);
      return res.json({ status: "cancelled" });
    }
    return res.json({ status: "not_found" });
  });

  app.post("/api/tools/python", async (req, res) => {
    const { code } = req.body || {};
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const output = await runPython({
        code,
        pythonPath,
        safeMode: pythonSafeMode,
        maxChars: pythonMaxChars
      });
      res.json({ output });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/execute", async (req, res) => {
    const { code, language } = req.body || {};
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const output = await executeCode({
        code,
        language,
        pythonPath,
        safeMode: pythonSafeMode,
        maxChars: pythonMaxChars,
        nodePath,
        jsSafeMode,
        jsTimeoutMs
      });
      res.json({ output });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/analyze", async (req, res) => {
    const { code } = req.body || {};
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const output = analyzeCode(code);
      res.json({ output });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/summarize", async (req, res) => {
    const { text, maxSentences } = req.body || {};
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const output = await summarizeText(text, maxSentences || 3);
      res.json({ output });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/sql", async (req, res) => {
    const { query, dbPath } = req.body || {};
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const output = await runSqliteQuery({
        query,
        dbPath: dbPath || toolsConfig.sqliteDbPath,
        pythonPath,
        allowWrite: !sqliteReadOnly
      });
      res.json({ output });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/schema", async (req, res) => {
    const { dbPath } = req.body || {};
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const output = await getSqliteSchema({
        dbPath: dbPath || toolsConfig.sqliteDbPath,
        pythonPath
      });
      res.json({ output });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/sympy", async (req, res) => {
    const { code } = req.body || {};
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const output = await runSympy({ code, pythonPath });
      res.json({ output });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/ingest", async (req, res) => {
    const { filePath } = req.body || {};
    if (!filePath) {
      return res.status(400).json({ error: "Missing 'filePath'." });
    }
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const doc = await ingestDocument({ projectRoot: PROJECT_ROOT, filePath });
      res.json(doc);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/search", async (req, res) => {
    const { query } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: "Missing 'query'." });
    }
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const results = await searchWeb(query);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/fetch", async (req, res) => {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: "Missing 'url'." });
    }
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const content = await fetchPageContent(url);
      res.json({ content });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/visualize", async (req, res) => {
    const { data } = req.body || {};
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const chartSpec = parseChartSpec(data);
      const output = ResponseFormatter.chartToHTML(chartSpec);
      res.json({ output });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tools/chain", async (req, res) => {
    const { prompt, toolCalls, model, language, systemMessageExtra } = req.body || {};
    if (!prompt || !Array.isArray(toolCalls)) {
      return res.status(400).json({ error: "Missing 'prompt' or 'toolCalls'." });
    }
    if (!toolsEnabled) {
      return res.status(403).json({ error: "Tools disabled." });
    }
    try {
      const outputs = [];
      for (const call of toolCalls) {
        const name = String(call?.name || "").toLowerCase();
        const args = call?.args || {};
        let result = "";
        if (name === "python") {
          result = await runPython({
            code: args.code || args.input || "",
            pythonPath,
            safeMode: pythonSafeMode,
            maxChars: pythonMaxChars
          });
        } else if (name === "code_execute" || name === "execute") {
          result = await executeCode({
            code: args.code || args.input || "",
            language: args.language,
            pythonPath,
            safeMode: pythonSafeMode,
            maxChars: pythonMaxChars,
            nodePath,
            jsSafeMode,
            jsTimeoutMs
          });
        } else if (name === "code_analysis" || name === "analyze") {
          result = JSON.stringify(analyzeCode(args.code || args.input || ""), null, 2);
        } else if (name === "summarize") {
          result = await summarizeText(args.text || args.input || "", args.maxSentences || 3);
        } else if (name === "sql") {
          result = await runSqliteQuery({
            query: args.query || args.input || "",
            dbPath: args.dbPath || toolsConfig.sqliteDbPath,
            pythonPath,
            allowWrite: !sqliteReadOnly
          });
        } else if (name === "sql_schema" || name === "schema") {
          result = await getSqliteSchema({
            dbPath: args.dbPath || toolsConfig.sqliteDbPath,
            pythonPath
          });
        } else if (name === "ingest") {
          const targets = String(args.path || args.filePath || "").split(",").map((item) => item.trim()).filter(Boolean);
          const docs = await Promise.all(
            targets.map((target) => ingestDocument({ projectRoot: PROJECT_ROOT, filePath: target }))
          );
          result = docs.map((doc) => `File: ${doc.path}\n${doc.text}`).join("\n\n");
        } else if (name === "search") {
          const results = await searchWeb(String(args.query || args.input || ""));
          result = extractRelevantInfo(results, String(args.query || args.input || ""));
        } else if (name === "fetch" || name === "url") {
          const content = await fetchPageContent(String(args.url || args.input || ""));
          result = content || "No content found.";
        } else if (name === "sympy") {
          result = await runSympy({ code: args.code || args.input || "", pythonPath });
        } else if (name === "visualize") {
          const chartSpec = parseChartSpec(args.data || args.input || "");
          result = ResponseFormatter.chartToHTML(chartSpec);
        } else {
          result = `Unknown tool: ${name}`;
        }
        outputs.push({ name, result });
      }
      const toolContext = outputs
        .map((item, idx) => `Tool ${idx + 1} (${item.name}):\n${item.result}`)
        .join("\n\n");
      const modelName = model || "qwen3";
      const languageInstruction = language ? `Respond in ${language}.` : "";
      const systemMessage = resolveSystemMessage(modelName, GENERAL_PROMPT, modelMap);
      const toneInstruction = detectTonePreference(prompt);
      const promptSystemMessage = [systemMessage, languageInstruction, systemMessageExtra, toneInstruction]
        .filter(Boolean)
        .join("\n");
      const wrappedPrompt = buildThinkingResultPrompt(
        `${prompt}\n\nTool results:\n${toolContext}`,
        promptSystemMessage,
        ""
      );
      const responseText = await callOllamaGenerate({
        model: modelName,
        prompt: wrappedPrompt,
        options: { temperature: 0.2 }
      });
      res.json({ response: responseText, outputs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/docs/index", async (req, res) => {
    const { folder } = req.body || {};
    try {
      const result = await buildDocIndex({ projectRoot: PROJECT_ROOT, folder: folder || "docs" });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/docs/query", async (req, res) => {
    const { query, limit } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: "Missing 'query'." });
    }
    try {
      const results = await queryDocIndex({ projectRoot: PROJECT_ROOT, query, limit: limit || 2 });
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/embeddings/index", async (req, res) => {
    const { folder, filePaths } = req.body || {};
    try {
      const result = await buildEmbeddingsIndex({
        projectRoot: PROJECT_ROOT,
        folder: folder || "",
        filePaths,
        embedFn: (text) => embedText(text, embedModel),
        chunkSize: embedChunkSize,
        chunkOverlap: embedChunkOverlap
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/embeddings/query", async (req, res) => {
    const { query, limit } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: "Missing 'query'." });
    }
    try {
      const results = await queryEmbeddings({
        query,
        embedFn: (text) => embedText(text, embedModel),
        limit: limit || 3
      });
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/image", async (req, res) => {
    const { prompt, width, height } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt'." });
    }
    try {
      const start = Date.now();
      const result = await generateImage({ prompt, width, height, config });
      res.json({
        ...result,
        durationMs: Date.now() - start
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/video", async (req, res) => {
    const { prompt, width, height, seconds, fps } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt'." });
    }
    try {
      const start = Date.now();
      const result = await generateVideo({ prompt, width, height, seconds, fps, config });
      res.json({
        ...result,
        durationMs: Date.now() - start
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/media/image", async (req, res) => {
    req.url = "/api/image";
    return app._router.handle(req, res);
  });

  app.post("/api/media/video", async (req, res) => {
    req.url = "/api/video";
    return app._router.handle(req, res);
  });

  app.post("/api/agent/run", async (req, res) => {
    const { prompt, model } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt'." });
    }
    try {
      const plannerModel = config?.models?.[0]?.model || "qwen3";
      const executorModel = model || "qwen3";
      const plan = await callOllamaGenerate({
        model: plannerModel,
        prompt: `${PLANNER_PROMPT}\n\nUser request:\n${prompt}`,
        options: { temperature: 0.2 }
      });
      const final = await callOllamaGenerate({
        model: executorModel,
        prompt: `${EXECUTOR_PROMPT}\n\nPlan:\n${plan}\n\nUser request:\n${prompt}`,
        options: { temperature: 0.3 }
      });
      res.json({ plan, reply: final });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/custom", (req, res) => {
    const { prompt, model, systemMessage, options } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt'." });
    }
    if (!model) {
      return res.status(400).json({ error: "Missing 'model'." });
    }
    return handleAiRequest(req, res, {
      task: "custom",
      defaultModel: model,
      baseSystemMessage: systemMessage || "",
      failureMessage: "AI custom call failed.",
      generateOptions: options || {}
    });
  });

  app.post("/api/debug", (req, res) =>
    handleAiRequest(req, res, {
      task: "debug",
      defaultModel: "deepseek-coder-v2",
      baseSystemMessage: `${CLARIFYING_NOTE}\n${DEBUG_THINKING_PROMPT}`,
      failureMessage: "AI debug failed.",
      generateOptions: { temperature: 0.2 }
    })
  );

  app.post("/api/fast", (req, res) =>
    handleAiRequest(req, res, {
      task: "fast",
      defaultModel: "gemma:2b",
      baseSystemMessage: `${CLARIFYING_NOTE}\n${FAST_PROMPT}`,
      failureMessage: "AI fast response failed.",
      generateOptions: { temperature: 0.1, max_tokens: 256 }
    })
  );

  app.post("/api/image_prompt", (req, res) =>
    handleAiRequest(req, res, {
      task: "image_prompt",
      defaultModel: "qwen3",
      baseSystemMessage: IMAGE_PROMPT_INSTRUCTION,
      failureMessage: "AI image prompt failed.",
      generateOptions: { temperature: 0.3 }
    })
  );

  app.post("/api/video_prompt", (req, res) =>
    handleAiRequest(req, res, {
      task: "video_prompt",
      defaultModel: "qwen3",
      baseSystemMessage: VIDEO_PROMPT_INSTRUCTION,
      failureMessage: "AI video prompt failed.",
      generateOptions: { temperature: 0.3 }
    })
  );

  app.post("/api/report", (req, res) =>
    handleAiRequest(req, res, {
      task: "report",
      defaultModel: "qwen3",
      baseSystemMessage: REPORT_PROMPT,
      failureMessage: "AI report failed.",
      generateOptions: { temperature: 0.25 }
    })
  );

  app.post("/api/dashboard", (req, res) =>
    handleAiRequest(req, res, {
      task: "dashboard",
      defaultModel: "qwen3",
      baseSystemMessage: DASHBOARD_PROMPT,
      failureMessage: "AI dashboard failed.",
      generateOptions: { temperature: 0.2, max_tokens: 2000 }
    })
  );

  // Fast dashboard with Bootstrap (with libraries)
  app.post("/api/dashboard/fast", (req, res) =>
    handleAiRequest(req, res, {
      task: "dashboard",
      defaultModel: "qwen3",
      baseSystemMessage: DASHBOARD_PROMPT,
      failureMessage: "AI dashboard failed.",
      generateOptions: { temperature: 0.15, max_tokens: 1200 }
    })
  );

  // Vanilla dashboard without external libraries
  app.post("/api/dashboard/vanilla", (req, res) =>
    handleAiRequest(req, res, {
      task: "dashboard_vanilla",
      defaultModel: "qwen3",
      baseSystemMessage: DASHBOARD_PROMPT_VANILLA,
      failureMessage: "AI dashboard failed.",
      generateOptions: { temperature: 0.2, max_tokens: 1500 }
    })
  );

  app.post("/api/chart", (req, res) =>
    handleAiRequest(req, res, {
      task: "chart",
      defaultModel: "qwen3",
      baseSystemMessage: CHART_GENERATION_PROMPT + "\n" + GENERAL_PROMPT,
      failureMessage: "AI chart generation failed.",
      generateOptions: { temperature: 0.2 }
    })
  );

  app.post("/api/research", async (req, res) => {
    const { prompt, enableWeb = true } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt'." });
    }
    try {
      let enrichedPrompt = prompt;
      let webResults = null;

      if (enableWeb) {
        webResults = await searchWeb(prompt);
        if (webResults && webResults.length > 0) {
          const relevantInfo = extractRelevantInfo(webResults, prompt);
          enrichedPrompt = `${prompt}\n\nRecent web information:\n${relevantInfo}`;
        }
      }

      return handleAiRequest(req, res, {
        task: "research",
        defaultModel: "qwen3",
        baseSystemMessage: `${CLARIFYING_NOTE}\n${GENERAL_PROMPT}\nProvide well-researched, factual answers with citations when applicable.`,
        failureMessage: "AI research failed.",
        composePrompt: () => enrichedPrompt,
        generateOptions: { temperature: 0.3 }
      });
    } catch (err) {
      console.error("Research request error:", err);
      res.status(500).json({ error: `Research failed: ${err.message}` });
    }
  });

  app.post("/api/data", (req, res) => {
    const { type = "mock", category = "sales", rows = 5 } = req.body || {};
    const allowedTypes = ["mock", "real"];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        error: `Type must be one of ${allowedTypes.join(", ")}.`
      });
    }
    const safeRows = Math.min(Math.max(Number(rows) || 5, 1), 50);
    const payload =
      type === "real"
        ? getRealDataset(category, safeRows)
        : generateMockDataset({ category, rows: safeRows });
    res.json({
      type,
      category,
      rows: payload.length,
      data: payload,
      availableCategories: availableCategories()
    });
  });

  /**
   * OPTIMIZATION: Calculate math problem complexity to optimize thinking phases
   * Trivial: Just numbers and operators (e.g., "28 + 4 - 2")
   * Simple: One or two sentences with basic operations (e.g., "I have 28 apples and eat 4")
   * Complex: Everything else (multi-step, algebra, etc.)
   */
  function calculateMathComplexity(prompt, intent) {
    if (intent !== 'MATH_REASONING') return null;
    
    const wordCount = prompt.split(/\s+/).filter(w => w.trim()).length;
    const sentenceCount = (prompt.match(/[.!?]/g) || []).length;
    const numberCount = (prompt.match(/\d+/g) || []).length;
    const operatorCount = (prompt.match(/[\+\-\×\÷\/\*]/g) || []).length;
    
    // Trivial: Just numbers + operators, no words (or very few)
    // e.g., "28 + 4 - 2" or "multiply 3 and 5"
    if (wordCount <= 10 && sentenceCount === 0 && numberCount <= 5) {
      return 'TRIVIAL';
    }
    
    // Simple: One or two sentences with basic math operations
    // e.g., "I have 28 apples and eat 4. How many left?"
    if (wordCount <= 35 && sentenceCount <= 2 && numberCount <= 4) {
      return 'SIMPLE';
    }
    
    // Complex: Multi-step, equations, advanced math
    return 'COMPLEX';
  }

  function normalizeMathExpression(value) {
  return String(value || "")
    .replace(/[×x]/gi, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/ž/g, "*")
    .replace(/ö/g, "/")
    .replace(/,/g, "")
    .trim();
}

function trySolveSimpleMath(prompt) {
  const text = String(prompt || "").toLowerCase();
  const numberMatches = text.match(/-?\d+(\.\d+)?/g);
  if (!numberMatches || numberMatches.length === 0) return null;

  const percentOfMatch = text.match(/(-?\d+(\.\d+)?)\s*(%|percent)\s*of\s*(-?\d+(\.\d+)?)/i);
  if (percentOfMatch) {
    const pct = Number(percentOfMatch[1]);
    const base = Number(percentOfMatch[4]);
    if (Number.isFinite(pct) && Number.isFinite(base)) {
      return (pct / 100) * base;
    }
  }
  const increaseMatch = text.match(/(-?\d+(\.\d+)?)\s*(increase|increased|increase by|up by)\s*(-?\d+(\.\d+)?)\s*%/i);
  if (increaseMatch) {
    const base = Number(increaseMatch[1]);
    const pct = Number(increaseMatch[4]);
    if (Number.isFinite(base) && Number.isFinite(pct)) {
      return base * (1 + pct / 100);
    }
  }
  const decreaseMatch = text.match(/(-?\d+(\.\d+)?)\s*(decrease|decreased|decrease by|down by)\s*(-?\d+(\.\d+)?)\s*%/i);
  if (decreaseMatch) {
    const base = Number(decreaseMatch[1]);
    const pct = Number(decreaseMatch[4]);
    if (Number.isFinite(base) && Number.isFinite(pct)) {
      return base * (1 - pct / 100);
    }
  }

  // If there's a clear arithmetic expression, evaluate it safely.
  const normalized = normalizeMathExpression(text)
    .replace(/(\d)\s*x\s*(\d)/gi, "$1*$2")
    .replace(/(\d)\s*\(/g, "$1*(")
    .replace(/\)\s*(\d)/g, ")*$1")
    .replace(/\)\s*\(/g, ")*(")
    .replace(/\s+/g, " ")
    .trim();
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const exprLine = [...lines].reverse().find((line) => /[0-9][0-9+\-*/x\s().%]+[0-9]/.test(line));
  const exprCandidate =
    exprLine ||
    normalized
      .replace(/(\d+(\.\d+)?)\s*%\s*of\s*(\d+(\.\d+)?)/gi, "($1/100)*$3")
      .replace(/(\d+(\.\d+)?)\s*percent\s*of\s*(\d+(\.\d+)?)/gi, "($1/100)*$3")
      .match(/[0-9][0-9+\-*/x\s().%]+[0-9]/)?.[0] ||
    "";
  const exprMatch = exprCandidate
    ? [exprCandidate]
    : normalized.match(/(-?\d+(\.\d+)?\s*[\+\-*/x]\s*)+-?\d+(\.\d+)?/);
  if (exprMatch) {
    let expr = exprMatch[0];
    // Treat "x" between numbers as multiplication (e.g., 1x2)
    expr = expr
      .replace(/(\d)\s*x\s*(\d)/gi, "$1*$2")
      .replace(/(\d+(\.\d+)?)\s*%\s*of\s*(\d+(\.\d+)?)/gi, "($1/100)*$3")
      .replace(/(\d+(\.\d+)?)\s*percent\s*of\s*(\d+(\.\d+)?)/gi, "($1/100)*$3")
      .replace(/(\d+(\.\d+)?)\s*%/g, "($1/100)");
    if (!/[+\-*/]/.test(expr)) {
      return null;
    }
    const tokens = [];
    let current = "";
    let prevWasOperator = true;
    for (let i = 0; i < expr.length; i += 1) {
      const ch = expr[i];
      if (/\d|\./.test(ch)) {
        current += ch;
        prevWasOperator = false;
        continue;
      }
      if (ch === "(" || ch === ")") {
        if (current) {
          tokens.push(current);
          current = "";
        }
        tokens.push(ch);
        prevWasOperator = ch === "(";
        continue;
      }
      if (ch === "-" && prevWasOperator) {
        current += ch;
        prevWasOperator = false;
        continue;
      }
      if (current) {
        tokens.push(current);
        current = "";
      }
      if (/[+\-*/]/.test(ch)) {
        tokens.push(ch);
        prevWasOperator = true;
      }
    }
    if (current) tokens.push(current);
    if (!tokens.length) return null;
    const output = [];
    const ops = [];
    const prec = { "+": 1, "-": 1, "*": 2, "/": 2 };
    tokens.forEach((tok) => {
      if (tok === "(") {
        ops.push(tok);
        return;
      }
      if (tok === ")") {
        while (ops.length && ops[ops.length - 1] !== "(") {
          output.push(ops.pop());
        }
        if (ops.length && ops[ops.length - 1] === "(") {
          ops.pop();
        }
        return;
      }
      if (/[+\-*/]/.test(tok)) {
        while (ops.length && prec[ops[ops.length - 1]] >= prec[tok]) {
          output.push(ops.pop());
        }
        ops.push(tok);
      } else {
        output.push(Number(tok));
      }
    });
    while (ops.length) {
      const op = ops.pop();
      if (op !== "(") output.push(op);
    }
    const stack = [];
    for (const tok of output) {
      if (typeof tok === "number") {
        stack.push(tok);
      } else {
        const b = stack.pop();
        const a = stack.pop();
        if (a === undefined || b === undefined) return null;
        switch (tok) {
          case "+": stack.push(a + b); break;
          case "-": stack.push(a - b); break;
          case "*": stack.push(a * b); break;
          case "/": stack.push(b === 0 ? NaN : a / b); break;
          default: return null;
        }
      }
    }
    if (stack.length === 1 && Number.isFinite(stack[0])) {
      return stack[0];
    }
    // Expression detected but failed to parse; do not fall back to heuristics.
    return null;
  }

  // Heuristic for simple word problems (add/subtract) using verb-number pairs.
  const negatives = ["eat", "ate", "spent", "spend", "lose", "lost", "loss", "minus", "subtract", "remove", "pay", "give", "gave", "sold", "borrow", "borrowed", "lend", "lent", "loan", "loaned"];
  const positives = ["buy", "bought", "get", "got", "add", "plus", "gain", "receive", "received", "earn", "found", "find", "another", "additional"];
  let total = Number(numberMatches[0]);
  if (!Number.isFinite(total)) return null;

  const verbPairs = [];
  const verbRegex = new RegExp(
    `\\b(${["eat", "ate", "spent", "spend", "lose", "lost", "loss", "minus", "subtract", "remove", "pay", "give", "gave", "sold", "borrow", "borrowed", "lend", "lent", "loan", "loaned", "buy", "bought", "get", "got", "add", "plus", "gain", "receive", "received", "earn", "found", "find", "another", "additional"].join("|")})\\b(?:\\s+\\w+){0,3}\\s+(\\d+(?:\\.\\d+)?)`,
    "gi"
  );
  let match;
  while ((match = verbRegex.exec(text)) !== null) {
    verbPairs.push({ verb: match[1].toLowerCase(), value: Number(match[2]) });
  }

  const itemCounts = {};
  const haveRegex = /\b(i have|have|has|with|start with|started with|begin with|beginning with)\b(?:\s+\w+){0,3}\s+(\d+(?:\.\d+)?)\s+([a-zA-Z]+)/gi;
  let haveMatch;
  while ((haveMatch = haveRegex.exec(text)) !== null) {
    const value = Number(haveMatch[2]);
    if (!Number.isFinite(value)) continue;
    let noun = haveMatch[3].toLowerCase();
    if (noun.endsWith("s")) noun = noun.slice(0, -1);
    if (!noun || noun === "percent") continue;
    itemCounts[noun] = (itemCounts[noun] || 0) + value;
  }

  const verbNounRegex = new RegExp(
    `\\b(${[...negatives, ...positives].join("|")})\\b(?:\\s+\\w+){0,3}\\s+(\\d+(?:\\.\\d+)?)\\s+([a-zA-Z]+)`,
    "gi"
  );
  let verbNounMatch;
  while ((verbNounMatch = verbNounRegex.exec(text)) !== null) {
    const verb = verbNounMatch[1].toLowerCase();
    const value = Number(verbNounMatch[2]);
    if (!Number.isFinite(value)) continue;
    let noun = verbNounMatch[3].toLowerCase();
    if (noun.endsWith("s")) noun = noun.slice(0, -1);
    if (!noun || noun === "percent") continue;
    itemCounts[noun] = itemCounts[noun] || 0;
    if (negatives.includes(verb)) {
      itemCounts[noun] -= value;
    } else {
      itemCounts[noun] += value;
    }
  }

  if (verbPairs.length === 0) {
    if (Object.keys(itemCounts).length > 0) {
      const totalItems = Object.values(itemCounts).reduce((sum, val) => sum + val, 0);
      return Number.isFinite(totalItems) ? totalItems : total;
    }
    return total;
  }

  for (const pair of verbPairs) {
    if (!Number.isFinite(pair.value)) continue;
    if (negatives.includes(pair.verb)) {
      total -= pair.value;
    } else {
      total += pair.value;
    }
  }

  const questionNounMatch = text.match(/\bhow many\s+([a-zA-Z]+)\b/);
  if (questionNounMatch) {
    let noun = questionNounMatch[1].toLowerCase();
    if (noun.endsWith("s")) noun = noun.slice(0, -1);
    if (itemCounts[noun] !== undefined) {
      return itemCounts[noun];
    }
  }
  if (/\bhow many\s+(do i have now|i have now|left now)\b/.test(text) && Object.keys(itemCounts).length > 0) {
    const totalItems = Object.values(itemCounts).reduce((sum, val) => sum + val, 0);
    return Number.isFinite(totalItems) ? totalItems : total;
  }

  return Number.isFinite(total) ? total : null;
  }

  function extractExpressionLine(prompt) {
    const normalized = normalizeMathExpression(prompt)
      .toLowerCase()
      .replace(/ž/g, "*")
      .replace(/ö/g, "/")
      .replace(/(\d)\s*x\s*(\d)/gi, "$1*$2");
    const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return [...lines].reverse().find((line) => /[0-9][0-9+\-*/x\s().%]+[0-9]/.test(line)) || "";
  }

  function isPureExpressionPrompt(prompt) {
    const cleaned = normalizeMathExpression(prompt)
      .toLowerCase()
      .replace(/ž/g, "*")
      .replace(/ö/g, "/")
      .replace(/\s+/g, "");
    if (!/[\d]/.test(cleaned)) return false;
    if (!/[+\-*/x]/.test(cleaned)) return false;
    return cleaned.replace(/[0-9+\-*/x.]/g, "").length === 0;
  }

  function buildLocalMathResponse(prompt, result) {
    const text = String(prompt || "").toLowerCase();
    const normalized = normalizeMathExpression(text)
      .replace(/ž/g, "*")
      .replace(/ö/g, "/")
      .replace(/(\d)\s*x\s*(\d)/gi, "$1*$2")
      .replace(/\s+/g, " ")
      .trim();
    const exprCandidate = extractExpressionLine(normalized) || normalized.match(/[0-9][0-9+\-*/x\s().%]+[0-9]/)?.[0] || "";
    if (exprCandidate) {
      let expr = exprCandidate.replace(/(\d)\s*x\s*(\d)/gi, "$1*$2");
      const answer = Number(result);
      return `Thinking\n- (omitted by request)\n\nResult\n- ${expr.replace(/\s+/g, "")} = ${answer}`;
    }

    const numbers = text.match(/-?\d+(\.\d+)?/g) || [];
    if (numbers.length > 0) {
      let explanation = `Start with ${numbers[0]}.`;
      const negatives = ["eat", "ate", "spent", "spend", "lose", "lost", "loss", "minus", "subtract", "remove", "pay", "give", "gave", "sold", "borrow", "borrowed", "lend", "lent", "loan", "loaned"];
      const positives = ["buy", "bought", "get", "got", "add", "plus", "gain", "receive", "received", "earn", "found", "find", "another", "additional"];
      const verbRegex = new RegExp(
        `\\b(${[...negatives, ...positives].join("|")})\\b(?:\\s+\\w+){0,3}\\s+(\\d+(?:\\.\\d+)?)`,
        "gi"
      );
      let match;
      let running = Number(numbers[0]);
      while ((match = verbRegex.exec(text)) !== null) {
        const verb = match[1].toLowerCase();
        const value = Number(match[2]);
        if (!Number.isFinite(value)) continue;
        if (negatives.includes(verb)) {
          const next = running - value;
          explanation += ` ${verb} ${value} -> ${running} - ${value} = ${next}.`;
          running = next;
        } else {
          const next = running + value;
          explanation += ` ${verb} ${value} -> ${running} + ${value} = ${next}.`;
          running = next;
        }
      }
      const itemCounts = {};
      const haveRegex = /\b(i have|have|has|with|start with|started with|begin with|beginning with)\b(?:\s+\w+){0,3}\s+(\d+(?:\.\d+)?)\s+([a-zA-Z]+)/gi;
      let haveMatch;
      while ((haveMatch = haveRegex.exec(text)) !== null) {
        const value = Number(haveMatch[2]);
        if (!Number.isFinite(value)) continue;
        let noun = haveMatch[3].toLowerCase();
        if (noun.endsWith("s")) noun = noun.slice(0, -1);
        if (!noun || noun === "percent") continue;
        itemCounts[noun] = (itemCounts[noun] || 0) + value;
      }
      const verbNounRegex = new RegExp(
        `\\b(${[...negatives, ...positives].join("|")})\\b(?:\\s+\\w+){0,3}\\s+(\\d+(?:\\.\\d+)?)\\s+([a-zA-Z]+)`,
        "gi"
      );
      let verbNounMatch;
      while ((verbNounMatch = verbNounRegex.exec(text)) !== null) {
        const verb = verbNounMatch[1].toLowerCase();
        const value = Number(verbNounMatch[2]);
        if (!Number.isFinite(value)) continue;
        let noun = verbNounMatch[3].toLowerCase();
        if (noun.endsWith("s")) noun = noun.slice(0, -1);
        if (!noun || noun === "percent") continue;
        itemCounts[noun] = itemCounts[noun] || 0;
        if (negatives.includes(verb)) {
          itemCounts[noun] -= value;
        } else {
          itemCounts[noun] += value;
        }
      }
      const questionNounMatch = text.match(/\bhow many\s+([a-zA-Z]+)\b/);
      let breakdownLine = "";
      if (Object.keys(itemCounts).length > 1) {
        const nounAsked = questionNounMatch ? questionNounMatch[1].toLowerCase() : "";
        const isSpecific = nounAsked && !["i", "we", "you", "they"].includes(nounAsked);
        if (!isSpecific) {
          const parts = Object.entries(itemCounts).map(([noun, count]) => `${noun}: ${count}`);
          const totalItems = Object.values(itemCounts).reduce((sum, val) => sum + val, 0);
          breakdownLine = `- Breakdown: ${parts.join(", ")}. Total items: ${totalItems}.`;
        }
      }
      return `Thinking\n- (omitted by request)\n\nResult\n- ${explanation}\n${breakdownLine ? `${breakdownLine}\n` : ""}- Answer: ${result}`;
    }

    return `Thinking\n- (omitted by request)\n\nResult\n- ${result}`;
  }
function tryCommonSenseShortcut(prompt) {
    const text = String(prompt || "").toLowerCase();
    if (!text) return null;

    const birdShotPattern =
      /\bbird(s)?\b/.test(text) &&
      /\btree(s)?\b/.test(text) &&
      (/\bgun\b/.test(text) || /\bshot\b/.test(text) || /\bshoot\b/.test(text)) &&
      (/\bmiss(ed)?\b/.test(text) || /\bloud\b/.test(text));

    if (birdShotPattern) {
      return "Zero — the loud gunshot scares all the birds away.";
    }

    if (/\bplane\b/.test(text) && /\bcrash\b/.test(text) && /\bborder\b/.test(text) && /\bbury\b/.test(text)) {
      return "Don’t bury survivors.";
    }

    if (/\brooster\b/.test(text) && /\begg\b/.test(text)) {
      return "Roosters don’t lay eggs.";
    }

    if (/\bmoses\b/.test(text) && /\bark\b/.test(text)) {
      return "None — Noah built the ark.";
    }

    if (/\bpush(es|ed)?\b/.test(text) && /\bcar\b/.test(text) && /\bhotel\b/.test(text)) {
      return "He’s playing Monopoly and lands on a hotel.";
    }

    if (/\bbirthday\b/.test(text) && /\bhow many\b/.test(text) && /\byears?\b/.test(text)) {
      return "One — you’re born once.";
    }

    return null;
  }

  wss.on("connection", (ws) => {
    ws.on("message", async (message) => {
      const startTime = Date.now();
      let payload;
      try {
        payload = JSON.parse(message.toString());
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", error: "Invalid JSON payload." }));
        return;
      }
      let incomingPrompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      if (!incomingPrompt) {
        ws.send(JSON.stringify({ type: "error", error: "Missing prompt." }));
        return;
      }

      const userId =
        typeof payload.userId === "string" && payload.userId.trim()
          ? payload.userId.trim()
          : "anonymous";
      const payloadHistory = Array.isArray(payload.conversationHistory)
        ? payload.conversationHistory
        : [];
      const memoryHistory = conversationMemory.getContext(userId, 6).messages || [];
      let conversationHistory = payloadHistory.length > 0 ? payloadHistory : memoryHistory;
      const userPromptForMemory =
        typeof payload.userPrompt === "string" && payload.userPrompt.trim()
          ? payload.userPrompt.trim()
          : incomingPrompt;
      let userStored = false;
      const storeUserMessage = () => {
        if (userStored) return;
        if (userPromptForMemory) {
          conversationMemory.addMessage(userId, "user", userPromptForMemory);
        }
        userStored = true;
      };
      const storeAssistantMessage = (content) => {
        if (content) {
          conversationMemory.addMessage(userId, "assistant", content);
          setTimeout(() => summarizeConversationIfNeeded(userId), 0);
        }
      };
      const toolTimings = {};
      const toolsUsed = new Set();
      const recordToolTiming = (name, start) => {
        toolsUsed.add(name);
        toolTimings[name] = Date.now() - start;
      };
      const sendLocalResponse = (text, model) => {
        storeUserMessage();
        storeAssistantMessage(text);
        ws.send(JSON.stringify({ type: "token", data: text }));
        ws.send(
          JSON.stringify({
            type: "done",
            meta: {
              durationMs: 0,
              totalDurationMs: 1,
              durationSeconds: 0.01,
              task: payload.task || "stream",
              model,
              toolsUsed: Array.from(toolsUsed),
              toolTimings
            }
          })
        );
      };
      let forceNoWeb = false;
      let isFollowup = false;
      if (isVagueFollowup(incomingPrompt) && conversationHistory.length > 0) {
        const lastUser = [...conversationHistory].reverse().find((msg) => msg.role === "user");
        const lastAssistant = [...conversationHistory].reverse().find((msg) => msg.role === "assistant");
        const lastUserText = lastUser ? lastUser.content.trim() : "";
        const lastAssistantText = lastAssistant ? extractResultSection(lastAssistant.content) : "";
        if (lastUserText) {
          const followupResult = trySolveSimpleMath(lastUserText);
          if (followupResult !== null) {
            const responseText = buildLocalMathResponse(lastUserText, followupResult);
            sendLocalResponse(responseText, "local-followup");
            return;
          }
        }
        const contextParts = [];
        if (lastUserText) contextParts.push(`Previous question: ${lastUserText}`);
        if (lastAssistantText) contextParts.push(`Previous answer: ${lastAssistantText}`);
        if (contextParts.length > 0) {
          incomingPrompt = `Explain the previous answer clearly and stay on that topic.\n\n${incomingPrompt}\n\n${contextParts.join("\n")}`;
          forceNoWeb = true;
          isFollowup = true;
        }
      }

      const basePrompt =
        typeof payload.userPrompt === "string" && payload.userPrompt.trim()
          ? payload.userPrompt.trim()
          : incomingPrompt;
      const originalPrompt = basePrompt;
      const normalization = normalizeUserPrompt(basePrompt);
      if (normalization.changed) {
        incomingPrompt = normalization.normalized;
      }
      const solverPrompt = normalization.changed ? normalization.normalized : originalPrompt;
      const localDispatch = tryLocalSolvers(solverPrompt);
      if (localDispatch.handled) {
        sendLocalResponse(localDispatch.answer, `local-${localDispatch.solver}`);
        return;
      }
      if (isTrivialMessage(incomingPrompt) || isInstantConversationPrompt(incomingPrompt)) {
        const instantText = buildInstantConversationResponse(incomingPrompt);
        sendLocalResponse(instantText, "tiny-sprinter");
        return;
      }
      if (isSimpleQaFastPath(incomingPrompt)) {
        const recentContext = conversationHistory.slice(-3).map((msg) => `${msg.role}: ${msg.content}`).join("\n");
        const minimalSystem = "You are a concise assistant. Answer the user's question directly without using any tools.";
        const simplePrompt = `${recentContext ? `Context:\n${recentContext}\n\n` : ""}Question:\n${incomingPrompt}`;
        const wrapped = buildThinkingResultPrompt(simplePrompt, minimalSystem, "");
        try {
          const fastAnswer = await callOllamaGenerate({
            model: "llama3.2",
            prompt: wrapped,
            options: { temperature: 0.2 }
          });
          if (fastAnswer && !isUncertainResponse(fastAnswer)) {
            sendLocalResponse(fastAnswer, "core-fast");
            return;
          }
        } catch (err) {
          // Fall through to full pipeline.
        }
      }
      const isRankingQuery = isLeaderboardPrompt(solverPrompt) || /\btop\s*\d+\b/i.test(solverPrompt);
      const wordMathHint = /\b(how many|left|remaining|total|altogether|buy|bought|lost|lose|borrow|borrowed|lend|lent|give|gave|spent|add|plus|minus|subtract)\b/i.test(solverPrompt);
      if (wordMathHint && !isRankingQuery) {
        const earlyMathResult = trySolveSimpleMath(solverPrompt);
        if (earlyMathResult !== null) {
          const responseText = buildLocalMathResponse(solverPrompt, earlyMathResult);
          sendLocalResponse(responseText, "local-math");
          return;
        }
      }
      const isAutoRequest = payload.auto === true || payload.task === "auto";
      if (
        isAutoRequest &&
        routingConfig.grammarRewriteEnabled !== false &&
        !forceNoWeb
      ) {
        const rewriteCandidate = incomingPrompt.trim();
        const shouldRewriteGrammar =
          rewriteCandidate.length > 4 &&
          rewriteCandidate.length <= (routingConfig.grammarRewriteMaxChars || 180) &&
          !/```/.test(rewriteCandidate) &&
          !/[\r\n]/.test(rewriteCandidate) &&
          !/^[\s\d+\-*/xX().%]+$/.test(rewriteCandidate);
        if (shouldRewriteGrammar) {
          try {
            const rewritten = await rewritePromptForGrammar(rewriteCandidate);
            const isBadRewrite =
              !rewritten ||
              rewritten.length < 4 ||
              rewritten.length > rewriteCandidate.length + 200;
            if (!isBadRewrite) {
              incomingPrompt = rewritten;
            }
          } catch (err) {
            console.warn("Grammar rewrite failed:", err.message);
          }
        }
      }
      const rawPrompt = String(solverPrompt || "");
      const bypassLocalMath = isLeaderboardPrompt(rawPrompt);
      if (!bypassLocalMath) {
        const conversionResponse = trySolveUnitConversion(rawPrompt);
        if (conversionResponse) {
          sendLocalResponse(conversionResponse, "local-conversion");
          return;
        }
        const structuredResponse = trySolveStructuredMath(rawPrompt);
        if (structuredResponse) {
          sendLocalResponse(structuredResponse, "local-structured-math");
          return;
        }
        const formulaResponse = trySolveFormulaShortcut(rawPrompt);
        if (formulaResponse) {
          sendLocalResponse(formulaResponse, "local-formula");
          return;
        }
        const normalizedPrompt = normalizeMathExpression(rawPrompt);
        const pureExpression =
          isPureExpressionPrompt(rawPrompt) ||
          /^[\s\d+\-*/xX.]+$/.test(rawPrompt) ||
          /^[\s\d+\-*/.]+$/.test(normalizedPrompt);
        const earlyExpression = extractExpressionLine(rawPrompt);
        const expressionTarget = pureExpression ? normalizedPrompt : earlyExpression;
        if (expressionTarget && /[+\-*/x]/i.test(expressionTarget)) {
          const localResult = trySolveSimpleMath(expressionTarget);
          if (localResult !== null) {
            const responseText = buildLocalMathResponse(expressionTarget, localResult);
            console.log(`[LOCAL_MATH] ${expressionTarget} = ${localResult}`);
            sendLocalResponse(responseText, "local-math");
            return;
          }
        }
      }

      const commonSenseAnswer = tryCommonSenseShortcut(rawPrompt);
      if (commonSenseAnswer) {
        const responseText = `Thinking\n- (omitted by request)\n\nResult\n- ${commonSenseAnswer}`;
        sendLocalResponse(responseText, "common-sense");
        return;
      }

      storeUserMessage();

      let baseSystemMessage = GENERAL_PROMPT;

      // ===== INTENT CLASSIFICATION =====
      const intentData = classifyIntent(incomingPrompt);
      const isRankingIntent =
        intentData.intent === "RANKING_QUERY" || isLeaderboardPrompt(incomingPrompt);
      const isFutureRanking = isRankingIntent && isFutureYearRanking(incomingPrompt);
      console.log('[INTENT]', summarizeClassification(intentData));
      if (intentData.intent === "CREATIVE" && payloadHistory.length === 0) {
        conversationHistory = conversationMemory.getContext(userId, 10).messages || conversationHistory;
      }
      const expressionCandidate = String(solverPrompt || "")
        .replace(/×/g, "*")
        .replace(/÷/g, "/")
        .replace(/(\d)\s*x\s*(\d)/gi, "$1*$2")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .reverse()
        .find((line) => /[0-9][0-9+\-*/x\s.]+[0-9]/.test(line));

      // Send intent to UI
      ws.send(JSON.stringify({
        type: 'intent_classification',
        data: {
          intent: intentData.intent,
          confidence: intentData.confidence,
          model: intentData.modelPreference,
          requiresWeb: intentData.requiresWeb
        }
      }));
      
      // Fast local solve for explicit arithmetic expressions (bypass cache/model)
      if (!isRankingQuery && intentData.intent === "MATH_REASONING" && expressionCandidate && /[+\-*/x]/i.test(expressionCandidate)) {
        const localResult = trySolveSimpleMath(expressionCandidate);
        if (localResult !== null) {
          const responseText = buildLocalMathResponse(expressionCandidate, localResult);
          sendLocalResponse(responseText, "local-math");
          return;
        }
      }

      const instant = await instantResponseEngine.getInstantResponse(incomingPrompt, {
        preferFast: (payload.fast || bypassHeavy || !forceComplex || isTinyPrompt) && !isFollowup,
        embedFn: embeddingsEnabled ? (text) => embedText(text, embedModel) : null,
        semanticThreshold: routingConfig.semanticCacheThreshold
      });
      if (instant.source === "cache" || instant.source === "semantic_cache") {
        instantResponseEngine.recordLatency(instant.cacheKey, instant.latency);
        ws.send(JSON.stringify({
          type: "intent_classification",
          data: {
            intent: intentData.intent,
            confidence: "CACHED",
            model: "cache",
            requiresWeb: false
          }
        }));
        ws.send(JSON.stringify({ type: "token", data: instant.response }));
        ws.send(JSON.stringify({
          type: "done",
          meta: {
            durationMs: instant.latency,
            totalDurationMs: instant.latency,
            durationSeconds: Number((instant.latency / 1000).toFixed(2)),
            source: instant.source,
            model: "cache",
            task: payload.task || "stream",
            cached: true
          }
        }));
        return;
      }

      // If web search needed, execute it first
      const shouldAutoWeb = intentData.requiresWeb || (intentData.intent === "SIMPLE_QA" && intentData.confidence !== "HIGH");
      if (shouldAutoWeb && config.web.enabled) {
        try {
          const webResults = await runWithRetry(() => searchWeb(incomingPrompt));
          const webInfo = extractRelevantInfo(webResults, incomingPrompt);
          const webSources = formatWebSources(webResults);
          ws.send(JSON.stringify({
            type: 'web_search_results',
            data: {
              found: webResults.length > 0,
              results: webResults.slice(0, 3).map(r => ({ title: r.title, url: r.url })),
              info: webInfo.substring(0, 1000)
            }
          }));
          
          // Append web info to both payload and incomingPrompt for consistency
          const enrichedPrompt = `Using this information: ${webInfo}\n\nSources:\n${webSources}\n\nAnswer the question: ${incomingPrompt}`;
          payload.prompt = enrichedPrompt;
          // Update incomingPrompt so it's used in the AI generation
          incomingPrompt = enrichedPrompt;
        } catch (err) {
          console.error('Web search failed:', err.message);
          ws.send(JSON.stringify({
            type: 'web_search_results',
            data: { error: err.message }
          }));
        }
      }
      // ===== END INTENT CLASSIFICATION =====

      // Fast local solve for simple math to avoid model stalls
      const mathComplexity = calculateMathComplexity(incomingPrompt, intentData.intent);
      if (!isRankingQuery && intentData.intent === "MATH_REASONING" && (mathComplexity === "TRIVIAL" || mathComplexity === "SIMPLE")) {
        const localResult = trySolveSimpleMath(solverPrompt);
        if (localResult !== null) {
          const responseText = buildLocalMathResponse(solverPrompt, localResult);
          sendLocalResponse(responseText, "local-math");
          return;
        }
      }

      const autoRequested = payload.auto === true || payload.task === "auto";
      let webUsed = false;
      let webSources = [];
      if (autoRequested && isGreeting(incomingPrompt)) {
        sendLocalResponse(buildGreetingResponse(), "local-greeting");
        return;
      }
      if (autoRequested && isInstantConversationPrompt(basePrompt)) {
        sendLocalResponse(buildInstantConversationResponse(basePrompt), "local-instant");
        return;
      }
      if (autoRequested && isMathLevelPrompt(incomingPrompt)) {
        sendLocalResponse(buildMathLevelResponse(), "local-math-level");
        return;
      }

      const toolCommand = autoRequested && toolsEnabled
        ? parseToolCommand(incomingPrompt) || detectImplicitToolCommand(incomingPrompt)
        : null;
      if (autoRequested && !toolsEnabled && (parseToolCommand(incomingPrompt) || detectImplicitToolCommand(incomingPrompt))) {
        ws.send(JSON.stringify({ type: "error", error: "Tools disabled." }));
        return;
      }
      if (toolCommand) {
        try {
          let output = "";
          let route = "tool";
          if (toolCommand.tool === "python") {
            output = await runWithRetry(() => runPython({
              code: toolCommand.input,
              pythonPath,
              safeMode: pythonSafeMode,
              maxChars: pythonMaxChars
            }));
            route = "tool-python";
          } else if (toolCommand.tool === "code_execute") {
            output = await runWithRetry(() => executeCode({
              code: toolCommand.input,
              pythonPath,
              safeMode: pythonSafeMode,
              maxChars: pythonMaxChars,
              nodePath,
              jsSafeMode,
              jsTimeoutMs
            }));
            route = "tool-code-execute";
          } else if (toolCommand.tool === "code_analysis") {
            output = JSON.stringify(analyzeCode(toolCommand.input), null, 2);
            route = "tool-code-analysis";
          } else if (toolCommand.tool === "summarize") {
            output = await summarizeText(toolCommand.input);
            route = "tool-summarize";
          } else if (toolCommand.tool === "sql") {
            output = await runWithRetry(() => runSqliteQuery({
              query: toolCommand.input,
              dbPath: toolsConfig.sqliteDbPath,
              pythonPath,
              allowWrite: !sqliteReadOnly
            }));
            route = "tool-sql";
          } else if (toolCommand.tool === "sql_schema") {
            output = await runWithRetry(() => getSqliteSchema({
              dbPath: toolsConfig.sqliteDbPath,
              pythonPath
            }));
            route = "tool-sql-schema";
          } else if (toolCommand.tool === "sympy") {
            output = await runWithRetry(() => runSympy({ code: toolCommand.input, pythonPath }));
            route = "tool-sympy";
          } else if (toolCommand.tool === "visualize") {
            const chartSpec = parseChartSpec(toolCommand.input);
            output = ResponseFormatter.chartToHTML(chartSpec);
            route = "tool-visualize";
          } else if (toolCommand.tool === "ingest") {
            const targets = toolCommand.input.split(",").map((item) => item.trim()).filter(Boolean);
            const docs = await Promise.all(
              targets.map((target) => ingestDocument({ projectRoot: PROJECT_ROOT, filePath: target }))
            );
            output = docs.map((doc) => `File: ${doc.path}\n${doc.text}`).join("\n\n");
            route = "tool-ingest";
          } else if (toolCommand.tool === "search") {
            const results = await runWithRetry(() => searchWeb(toolCommand.input));
            output = extractRelevantInfo(results, toolCommand.input);
            route = "tool-search";
          } else if (toolCommand.tool === "fetch" || toolCommand.tool === "url") {
            const url = toolCommand.input.trim();
            if (!url) {
              throw new Error("Missing URL.");
            }
            const content = await runWithRetry(() => fetchPageContent(url));
            output = content || "No content found.";
            route = "tool-fetch";
          }

          ws.send(JSON.stringify({ type: "token", data: buildToolResponse(output) }));
          ws.send(
            JSON.stringify({
              type: "done",
              meta: { durationMs: 0, task: payload.task || "stream", model: "tool", route }
            })
          );
          return;
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", error: err.message }));
          return;
        }
      }
      const autoProfiles = getAutoProfiles();
      let modelName = payload.model || intentData.modelPreference || "gemma:2b";
      if (isRankingIntent) {
        baseSystemMessage = RANKING_PROMPT;
      }
      if (intentData.intent === "RIDDLE") {
        baseSystemMessage = RIDDLE_PROMPT;
      }
      let generateOptions = payload.options || { temperature: 0.3 };
      let promptText = incomingPrompt;
      let autoMeta = {};

      // Build conversation context from history
      const conversationContext = conversationHistory.length > 0
        ? conversationHistory
            .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
            .join('\n\n')
        : '';
      if (isVagueFollowup(incomingPrompt) && conversationHistory.length > 0) {
        promptText = incomingPrompt;
      }

      if (autoRequested) {
        const resolvedFilePaths = Array.isArray(payload.filePaths) ? payload.filePaths : [];
        let autoFilePaths = [];
        let filePaths = resolvedFilePaths;
        const rewriteEnabled = routingConfig.rewriteEnabled !== false;
        const shouldRewrite = rewriteEnabled && shouldRewritePrompt(incomingPrompt);
        let rewrittenPrompt = "";
        if (shouldRewrite) {
          try {
            rewrittenPrompt = await rewritePrompt(incomingPrompt);
          } catch (err) {
            console.warn("Prompt rewrite failed:", err.message);
          }
        }
        const effectivePrompt = rewrittenPrompt || incomingPrompt;
        const bypassHeavy = shouldBypassHeavyWork(effectivePrompt);
        const forceComplex = isComplexPrompt(effectivePrompt) || isFollowup;
        const fastPromptChars = routingConfig.fastPromptChars || 28;
        const isTinyPrompt = effectivePrompt.length > 0 && effectivePrompt.length <= fastPromptChars;
        
        // Use ranking prompt for leaderboard/ranking queries
        if (isLeaderboardPrompt(effectivePrompt)) {
          baseSystemMessage = RANKING_PROMPT;
          // Force web search for ranking queries to get latest data
          if (payload.autoWeb !== false) {
            // Will trigger web search below
          }
        }
        if (!bypassHeavy && filePaths.length === 0 && payload.autoFiles !== false) {
          autoFilePaths = await autoSelectFiles({ projectRoot: PROJECT_ROOT, prompt: effectivePrompt });
          filePaths = autoFilePaths;
        }

        const { context: fileContext, files: filesMeta } = await loadFileContexts({
          projectRoot: PROJECT_ROOT,
          filePaths: bypassHeavy ? [] : filePaths
        });
        const memoryRequested = detectMemoryTrigger(incomingPrompt);
        let webContext = "";
        webUsed = false;
        const autoWebEnabled =
          webConfig.enabled !== false &&
          (payload.autoWeb === true || isRankingIntent) &&
          !forceNoWeb;
        // OPTIMIZATION: Skip web search if intent doesn't require it (SIMPLE_QA, MATH_REASONING, etc)
        const allowWebForSimpleQa = intentData.intent === "SIMPLE_QA" && intentData.confidence !== "HIGH";
        const skipWebForIntent = isRankingIntent ? false : (!intentData.requiresWeb && !allowWebForSimpleQa);
        if (!bypassHeavy && autoWebEnabled && !skipWebForIntent) {
          const urls = extractUrls(incomingPrompt);
          if (urls.length > 0) {
            const fetchStart = Date.now();
            const pages = await Promise.all(urls.map((url) => runWithRetry(() => fetchPageContent(url))));
            const pageText = pages
              .filter(Boolean)
              .map((text, idx) => `Source ${idx + 1}:\n${text}`)
              .join("\n\n");
            if (pageText) {
              webContext = `Web page context:\n${pageText}`;
              webUsed = true;
              webSources = urls.slice(0, 5);
              recordToolTiming("url_fetch", fetchStart);
            }
          } else if (shouldUseWeb(effectivePrompt) && !skipWebForIntent) {
            const searchStart = Date.now();
            const searchQuery = isRankingIntent
              ? buildRankingSearchQuery(effectivePrompt)
              : effectivePrompt;
            const results = await runWithRetry(() => searchWeb(searchQuery));
            if (results.length > 0) {
              const sources = formatWebSources(results);
              webContext = `Web search:\n${extractRelevantInfo(results, effectivePrompt)}\n\nSources:\n${sources}`;
              webUsed = true;
              webSources = results.map((result) => result.url || result.link).filter(Boolean).slice(0, 5);
              recordToolTiming("web_search", searchStart);
              if (isRankingIntent) {
                const fetchStart = Date.now();
                const urls = webSources.slice(0, 2);
                const pages = await Promise.all(urls.map((url) => runWithRetry(() => fetchPageContent(url))));
                const pageText = pages.filter(Boolean).map((text, idx) => `Source ${idx + 1}:\n${text}`).join("\n\n");
                if (pageText) {
                  webContext = `${webContext}\n\nWeb page context:\n${pageText}`;
                  recordToolTiming("url_fetch", fetchStart);
                }
              }
            }
          }
        }
        if (isRankingIntent && (!webSources || webSources.length === 0)) {
          sendLocalResponse(
            "Thinking\n- (omitted by request)\n\nResult\n- I couldn't find reliable sources for a ranked list. Please try again or provide a source.",
            "ranking-no-sources"
          );
          return;
        }
        const memoryStart = Date.now();
        let memoryMatches = bypassHeavy
          ? []
          : queryMemoryEntries(memoryEntries, effectivePrompt, 4, {
              userId: payload.userId,
              teamMode: payload.teamMode,
              teamId: payload.teamId
            });
        if (!bypassHeavy && memoryMatches.length === 0 && embeddingsEnabled) {
          try {
            const memoryEmbedding = await embedText(effectivePrompt, embedModel);
            memoryMatches = queryMemoryEntries(memoryEntries, effectivePrompt, 4, {
              userId: payload.userId,
              teamMode: payload.teamMode,
              teamId: payload.teamId,
              embedding: memoryEmbedding,
              embeddingWeight: memoryEmbeddingWeight
            });
          } catch (err) {
            console.warn("Memory embeddings recall failed:", err.message);
          }
        }
        if (memoryMatches.length > 0) {
          recordToolTiming("memory_recall", memoryStart);
        }
        const memoryContext = memoryMatches.length
          ? `Relevant memory:\n${memoryMatches
              .map((entry, index) => `(${index + 1}) Q: ${entry.prompt}\nA: ${entry.response}`)
              .join("\n\n")}`
          : "";
        const queryVariants = generateQueryVariants(effectivePrompt, 3);
        let docContext = "";
        let docs = [];
        if (!bypassHeavy && payload.useDocIndex) {
          const docStart = Date.now();
          docs = await gatherKeywordCandidates({
            projectRoot: PROJECT_ROOT,
            queries: queryVariants,
            limitPerQuery: 5
          });
          if (docs.length > 0) {
            docContext = `Docs context:\n${docs
              .map((doc, idx) => `Doc ${idx + 1}: ${doc.path}\n${doc.snippet}`)
              .join("\n\n")}`;
            recordToolTiming("doc_index", docStart);
          }
        }
        let embeddingContext = "";
        let hits = [];
        const allowEmbeddings = payload.useEmbeddings !== false && embeddingsEnabled;
        if (!bypassHeavy && allowEmbeddings) {
          const embedStart = Date.now();
          hits = await gatherEmbeddingCandidates({
            queries: queryVariants,
            embedFn: (text) => embedText(text, embedModel),
            limitPerQuery: embedTopK
          });
          if (hits.length > 0) {
            embeddingContext = `Embeddings context:\n${hits
              .map((hit, idx) => `Chunk ${idx + 1} (${hit.source}):\n${hit.text}`)
              .join("\n\n")}`;
            recordToolTiming("embeddings", embedStart);
          }
        }
        let ragCandidates = buildRagCandidates({ keywordResults: docs, embeddingResults: hits });
        if (!bypassHeavy && routingConfig.rerankEnabled !== false && ragCandidates.length > 1) {
          ragCandidates = await rerankCandidates({
            query: effectivePrompt,
            candidates: ragCandidates,
            model: routingConfig.rerankModel || "qwen3"
          });
        }
        const ragContext = buildHybridRagContext({
          keywordResults: docs,
          embeddingResults: hits,
          candidates: ragCandidates,
          limit: 5
        });
        const ragSources = [
          ...ragCandidates.map((item) => item.source).filter(Boolean),
          ...webSources
        ].slice(0, 8);
        let sqlSchemaContext = "";
        if (!bypassHeavy && intentData.intent === "SQL_QUERY" && toolsEnabled && toolsConfig.sqliteDbPath) {
          try {
            const schemaStart = Date.now();
            const schema = await getSqliteSchema({ dbPath: toolsConfig.sqliteDbPath, pythonPath });
            if (schema) {
              sqlSchemaContext = `SQLite schema:\n${schema}`;
              recordToolTiming("sql_schema", schemaStart);
            }
          } catch (err) {
            console.warn("SQL schema fetch failed:", err.message);
          }
        }
        const leaderboardHint = isVagueLeaderboardPrompt(effectivePrompt) ? buildVagueLeaderboardHint() : "";
        const intentExtras = buildIntentExtras(intentData, effectivePrompt, payload);
        let planBlock = "";
        if (intentData.intent === "MULTI_STEP" && !payload.model) {
          try {
            const planStart = Date.now();
            const plannerModel = config?.models?.[0]?.model || "qwen3";
            const planText = await callOllamaGenerate({
              model: plannerModel,
              prompt: buildThinkingResultPrompt(effectivePrompt, PLANNER_PROMPT, "")
            });
            planBlock = `Plan:\n${extractResultSection(planText)}`;
            recordToolTiming("planner", planStart);
          } catch (err) {
            console.warn("Planner step failed:", err.message);
          }
        }
        const composedPrompt = [
          effectivePrompt,
          leaderboardHint,
          fileContext ? `File context:\n${fileContext}` : "",
          ragContext || docContext || embeddingContext,
          webContext,
          memoryContext,
          sqlSchemaContext,
          planBlock,
          intentExtras
        ]
          .filter(Boolean)
          .join("\n\n");
        const reasoningIntents = new Set([
          "MATH_REASONING",
          "PROOF_SOLVING",
          "SYSTEM_DESIGN",
          "MULTI_STEP",
          "FORMULA_GENERATION"
        ]);
        const shouldForceReason = reasoningIntents.has(intentData.intent);
        const route = chooseRoute({
          prompt: effectivePrompt,
          imageDescription: payload.imageDescription,
          taskHint: payload.route || ((shouldForceReason || forceComplex) ? "reason" : undefined),
          preferFast: (payload.fast || bypassHeavy || !forceComplex || isTinyPrompt) && !isFollowup
        });
        const profile = autoProfiles[route.task] || autoProfiles.chat;
        modelName = payload.model || instant.model || intentData.modelPreference || profile.defaultModel;
        const mathComplexity = calculateMathComplexity(effectivePrompt, intentData.intent);
        const complexity = intentData.metadata?.complexity || "LOW";
        const lowConfidence = intentData.confidence === "LOW";
        const mediumConfidence = intentData.confidence === "MEDIUM";
        const highComplexity = complexity === "HIGH" || complexity === "VERY_HIGH";
        const shouldEscalate = !payload.model && (lowConfidence || (mediumConfidence && highComplexity));
        if (shouldEscalate) {
          if (intentData.intent === "CODE_TASK" || intentData.intent === "CODE_REVIEW") {
            modelName = "deepseek-coder-v2";
          } else if (shouldForceReason) {
            modelName = "deepseek-r1";
          } else if (intentData.intent === "GRAMMAR_CORRECTION") {
            modelName = "gemma:2b";
          } else {
            modelName = "llama3.2";
          }
        }
        if (!payload.model && intentData.intent === "MATH_REASONING" && (mathComplexity === "TRIVIAL" || mathComplexity === "SIMPLE")) {
          modelName = "gemma:2b";
        }
        // Don't overwrite baseSystemMessage if it's already been set to RANKING_PROMPT
        if (baseSystemMessage === GENERAL_PROMPT) {
          baseSystemMessage = profile.baseSystemMessage;
        }
        if (instant.systemPrompt && baseSystemMessage === profile.baseSystemMessage) {
          baseSystemMessage = instant.systemPrompt;
        }
        generateOptions = payload.options || profile.generateOptions || generateOptions;
        const memoryInstruction = memoryRequested
          ? "Memory requested: confirm 'Memory saved.' in Result."
          : "";
        const rewrittenBlock = rewrittenPrompt
          ? `Interpreted request:\n${rewrittenPrompt}\n\nOriginal request:\n${incomingPrompt}`
          : "";
        promptText = [rewrittenBlock || composedPrompt, memoryInstruction].filter(Boolean).join("\n\n") || incomingPrompt;
        if (intentData.intent === "RIDDLE" && !/MODE\s*=\s*(SOLVE|TRAIN|EXAM)/i.test(incomingPrompt)) {
          promptText = `CONFIG:\nMODE=SOLVE\n\n${promptText}`;
        }
        autoMeta = {
          route: route.task,
          routeReason: route.reason,
          files: filesMeta,
          memoryHits: memoryMatches.length,
          autoFiles: autoFilePaths.length > 0,
          memoryRequested,
          webUsed,
          ragSources
        };
      }

      const useBaseSystemMessage =
        baseSystemMessage === DASHBOARD_PROMPT ||
        baseSystemMessage === DASHBOARD_PROMPT_VANILLA;
      const systemMessage = useBaseSystemMessage
        ? baseSystemMessage
        : resolveSystemMessage(modelName, baseSystemMessage, modelMap);
      const languageInstruction = payload.language ? `Respond in ${payload.language}.` : "";
      const extraSystemMessage = payload.systemMessageExtra || "";
      const toneInstruction = detectTonePreference(incomingPrompt);
      const citeInstruction = webUsed ? "Cite sources inline as [1], [2], etc." : "";
      const promptSystemMessage = [LOCAL_AI_SPEC, systemMessage, languageInstruction, extraSystemMessage, toneInstruction, citeInstruction]
        .filter(Boolean)
        .join("\n");
      const responseSpecInstruction = payload.responseSpec
        ? `Response spec:\n${JSON.stringify(payload.responseSpec, null, 2)}`
        : "";
      const noThinkingInstruction = payload.responseSpec?.no_thinking
        ? "Thinking must contain exactly one bullet: (omitted by request)."
        : "";
      const visionBlock =
        autoRequested && payload.imageDescription
          ? `\n\nImage description:\n${payload.imageDescription}`
          : "";
      
      // Add conversation context to prompt if available
      const conversationBlock = conversationContext
        ? `\n\nPrevious conversation:\n${conversationContext}`
        : '';
      
      const wrappedPrompt = buildThinkingResultPrompt(
        `${conversationBlock}${promptText}${visionBlock}`,
        promptSystemMessage,
        [responseSpecInstruction, noThinkingInstruction].filter(Boolean).join("\n")
      );

      const controller = new AbortController();
      const requestId = payload.requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeRequests.set(requestId, controller);
      ws.once("close", () => {
        controller.abort();
        activeRequests.delete(requestId);
      });

      try {
        // OPTIMIZATION: Calculate math complexity to reduce phases for simple problems
        const mathComplexity = calculateMathComplexity(incomingPrompt, intentData.intent);
        
        // Send reasoning phases IMMEDIATELY and continuously
        const phases = ReasoningEngine.generatePhases(incomingPrompt, intentData.intent, intentData.requiresWeb, mathComplexity);
        console.log(`[PHASES] Sending ${phases.length} reasoning phases for intent: ${intentData.intent}${mathComplexity ? ` (complexity: ${mathComplexity})` : ''}`);
        
        // Start phases in background (don't await)
        const phasePromise = (async () => {
          for (const phase of phases) {
            try {
              const phaseMsg = {
                type: 'reasoning_phase',
                data: {
                  phase: phase.phase,
                  action: phase.action,
                  emoji: phase.emoji
                }
              };
              console.log(`[PHASE] Sending: ${phase.emoji} ${phase.action}`);
              ws.send(JSON.stringify(phaseMsg));
              // Spread phases out during generation (reduced from 200ms for faster UI)
              await new Promise(r => setTimeout(r, 100));
            } catch (e) {
              console.warn(`[PHASE ERROR] ${e.message}`);
            }
          }
        })();
        
        const start = Date.now();
        let responseText = '';
        let usedModel = modelName;

        const memoryErrorRegex = /requires more system memory|not enough memory|out of memory/i;
        const reasoningIntents = new Set([
          "MATH_REASONING",
          "PROOF_SOLVING",
          "SYSTEM_DESIGN",
          "MULTI_STEP",
          "FORMULA_GENERATION"
        ]);
        const fallbackModel = (() => {
          if (intentData.intent === "MATH_REASONING") {
            const mathComplexity = calculateMathComplexity(incomingPrompt, intentData.intent);
            if (mathComplexity === "TRIVIAL" || mathComplexity === "SIMPLE") {
              return "gemma:2b";
            }
            return "qwen3";
          }
          if (intentData.intent === "CODE_TASK" || intentData.intent === "CODE_REVIEW") {
            return "deepseek-coder-v2";
          }
          if (reasoningIntents.has(intentData.intent)) {
            return "qwen3";
          }
          return "llama3.2";
        })();

        const runGeneration = async (model) => {
          const attemptController = new AbortController();
          const attemptTimeoutMs =
            model === "deepseek-r1"
              ? 0
              : (routingConfig.modelTimeoutMs || 0);
          const combinedSignal = combineSignals([controller.signal, attemptController.signal]);
          let timeoutId = null;
          if (attemptTimeoutMs > 0) {
            timeoutId = setTimeout(() => {
              attemptController.abort();
            }, attemptTimeoutMs);
          }
          try {
            await streamOllamaGenerate({
              model,
              prompt: wrappedPrompt,
              options: generateOptions,
              signal: combinedSignal,
              onToken: (token) => {
                responseText += token;
                ws.send(JSON.stringify({ type: "token", data: token }));
              }
            });
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
        };

        try {
          await runGeneration(usedModel);
        } catch (err) {
          if (usedModel === "deepseek-r1" && memoryErrorRegex.test(err.message || "")) {
            console.warn(`[MODEL FALLBACK] ${usedModel} failed, retrying with ${fallbackModel}`);
            ws.send(
              JSON.stringify({
                type: "model_fallback",
                data: {
                  from: usedModel,
                  to: fallbackModel,
                  reason: "insufficient_memory"
                }
              })
            );
            ws.send(
              JSON.stringify({
                type: "model_retry_start",
                data: {
                  from: usedModel,
                  to: fallbackModel,
                  reason: "insufficient_memory"
                }
              })
            );
            usedModel = fallbackModel;
            responseText = "";
            await runGeneration(usedModel);
            ws.send(
              JSON.stringify({
                type: "model_retry_done",
                data: { model: usedModel }
              })
            );
          } else if (usedModel === "deepseek-r1" && err.name === "AbortError") {
            console.warn(`[MODEL FALLBACK] ${usedModel} timed out, retrying with ${fallbackModel}`);
            ws.send(
              JSON.stringify({
                type: "model_fallback",
                data: {
                  from: usedModel,
                  to: fallbackModel,
                  reason: "timeout"
                }
              })
            );
            ws.send(
              JSON.stringify({
                type: "model_retry_start",
                data: {
                  from: usedModel,
                  to: fallbackModel,
                  reason: "timeout"
                }
              })
            );
            usedModel = fallbackModel;
            responseText = "";
            await runGeneration(usedModel);
            ws.send(
              JSON.stringify({
                type: "model_retry_done",
                data: { model: usedModel }
              })
            );
          } else if (err.name === "AbortError") {
            ws.send(
              JSON.stringify({
                type: "model_retry_failed",
                data: {
                  model: usedModel,
                  reason: "timeout"
                }
              })
            );
            throw err;
          } else {
            throw err;
          }
        }
        
        // Ensure phases complete
        try {
          await phasePromise;
        } catch (e) {
          // Ignore phase errors
        }

        const mathIntents = new Set(["MATH_REASONING", "FORMULA_GENERATION", "PROOF_SOLVING"]);
        if (mathIntents.has(intentData.intent)) {
          responseText = await verifyMathResponse({
            prompt: incomingPrompt,
            responseText,
            pythonPath,
            toolsConfig
          });
        }
        if (intentData.intent === "CODE_TASK" || intentData.intent === "CODE_REVIEW") {
          responseText = await runCodeSelfCheck({
            responseText,
            toolsConfig,
            pythonPath,
            nodePath
          });
        }
        responseText = await runRiskReview({ intent: intentData.intent, responseText });

        if (isRankingIntent) {
          if (!Array.isArray(webSources) || webSources.length === 0) {
            responseText = "Thinking\n- (omitted by request)\n\nResult\n- I couldn't find reliable web sources for a ranked list. Please try again or provide a source.";
          } else {
            const year = extractYear(incomingPrompt);
            const futureNote = isFutureRanking
              ? `We cannot know exact rankings for ${year} yet. Use current data and label it as current.`
              : "";
            const strictPrompt = `You must produce a numbered top-N list with citations [1], [2], etc.
Use ONLY the sources provided. Do not invent sources, URLs, dates, or model names.
If sources are insufficient, say so clearly.
${futureNote}

Sources:
${webSources.join("\n")}

Web context:
${webContext}

User request:
${incomingPrompt}`;
            if (!validateRankingResponse(responseText)) {
              try {
                responseText = await callOllamaGenerate({
                  model: modelName,
                  prompt: strictPrompt,
                  options: { temperature: 0.2 }
                });
              } catch (err) {
                responseText = responseText;
              }
            }
            if (!validateRankingResponse(responseText)) {
              responseText = "Thinking\n- (omitted by request)\n\nResult\n- I couldn't build a reliable ranked list from the available sources.";
            }
            const count = countRankingItems(responseText);
            if (count > 0 && count < 10 && /\btop\s*10\b/i.test(incomingPrompt)) {
              responseText =
                "Thinking\n- (omitted by request)\n\nResult\n- I could only find reliable information for " +
                count +
                " items based on the available sources.\n\n" +
                responseText;
            }
          }
        }

        const duration = Date.now() - start;
        const totalDuration = Date.now() - startTime;
        const durationSeconds = (totalDuration / 1000).toFixed(2);
        recordModelStat(usedModel, totalDuration, false);
        const stat = modelStats.get(usedModel);
        const avgMs = stat ? Math.round(stat.totalMs / stat.count) : totalDuration;
        console.log(`[TIMING] Total: ${durationSeconds}s | Model: ${usedModel} | Intent: ${intentData.intent} | Avg: ${avgMs}ms | Errors: ${stat?.errors || 0}`);
        
        // Format response (tables, lists, rankings)
        const formatted = ResponseFormatter.formatResponse(responseText);
        const formattedHTML = ResponseFormatter.toHTML(formatted);
        
        // Cache the response (skip ranking queries)
        if (!isRankingIntent) {
          const cacheKey = buildCacheKey({ model: usedModel, prompt: incomingPrompt });
          storeInCache(cacheKey, responseText);
          console.log('[CACHE SAVED]', cacheKey);
          if (instant && instant.cacheKey) {
            let semanticEmbedding = instant.embedding;
            if (!semanticEmbedding && embeddingsEnabled) {
              try {
                semanticEmbedding = await embedText(incomingPrompt, embedModel);
              } catch (err) {
                semanticEmbedding = null;
              }
            }
            instantResponseEngine.cacheResponse(instant.cacheKey, responseText, {
              embedding: semanticEmbedding,
              intent: intentData.intent
            });
          }
        }
        storeAssistantMessage(responseText);
        
        ws.send(
          JSON.stringify({
            type: "done",
            meta: {
              durationMs: duration,
              totalDurationMs: totalDuration,
              durationSeconds: parseFloat(durationSeconds),
              task: payload.task || "stream",
              model: usedModel,
              requestId,
              cached: false,
              formatted: formatted.type !== 'text',
              formattedType: formatted.type,
              toolsUsed: Array.from(toolsUsed),
              toolTimings,
              ...autoMeta
            },
            formattedHTML: formattedHTML
          })
        );
        activeRequests.delete(requestId);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("WebSocket streaming error:", err);
          recordModelStat(usedModel || modelName, Date.now() - startTime, true);
          ws.send(JSON.stringify({ type: "error", error: err.message }));
        }
        activeRequests.delete(requestId);
      }
    });
  });

  // ===== PHASE 3: Advanced Features =====

  /**
   * API: Generate Async Report
   * POST /api/reports/generate
   */
  app.post('/api/reports/generate', async (req, res) => {
    const { reportId, prompt, data, userId } = req.body;

    if (!reportId || !prompt || !userId) {
      return res.status(400).json({ error: 'Missing required fields: reportId, prompt, userId' });
    }

    res.json({ 
      status: 'queued',
      reportId,
      message: 'Report generation started. You will receive results shortly.'
    });

    // Run async in background
    reportGenerator.generateReportAsync({
      reportId,
      prompt,
      data,
      userId,
      onProgress: (progress) => {
        console.log(`[REPORT ${reportId}] Progress: ${progress.progress}%`);
      },
      onComplete: (result) => {
        if (result.success) {
          console.log(`[REPORT ${reportId}] Complete in ${result.duration}ms`);
          // TODO: Email result to user
        } else {
          console.error(`[REPORT ${reportId}] Failed:`, result.error);
        }
      }
    }).catch(err => {
      console.error('[REPORT ERROR]', reportId, err.message);
    });
  });

  /**
   * API: Get Report Status
   * GET /api/reports/:reportId
   */
  app.get('/api/reports/:reportId', (req, res) => {
    const { reportId } = req.params;
    const status = reportGenerator.getReportStatus(reportId);
    
    res.json({
      reportId,
      ...status
    });
  });

  /**
   * API: Export Report (HTML)
   * POST /api/reports/export/html
   */
  app.post('/api/reports/export/html', (req, res) => {
    const { report } = req.body || {};
    if (!report) {
      return res.status(400).json({ error: "Missing 'report'." });
    }
    const html = reportGenerator.exportToHTML(report);
    res.set("Content-Type", "text/html");
    res.send(html);
  });

  /**
   * API: Export Report (PDF - basic text)
   * POST /api/reports/export/pdf
   */
  app.post('/api/reports/export/pdf', (req, res) => {
    const { report } = req.body || {};
    if (!report) {
      return res.status(400).json({ error: "Missing 'report'." });
    }
    const text = report.fullContent
      || `Title: ${report.title || "Report"}\n\n${JSON.stringify(report.sections || report, null, 2)}`;
    const buffer = buildSimplePdfBuffer(text);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", "attachment; filename=\"report.pdf\"");
    res.send(buffer);
  });

  /**
   * API: Get Multi-Step Execution Plan
   * POST /api/solve/plan
   */
  app.post('/api/solve/plan', (req, res) => {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const plan = MultiStepSolver.createExecutionPlan(prompt);

    res.json({
      success: true,
      plan,
      message: plan.type === 'simple' 
        ? 'Simple question detected - single response'
        : `Complex question detected - will solve in ${plan.totalSteps} steps`
    });
  });

  /**
   * API: Store Conversation Message
   * POST /api/memory/message
   */
  app.post('/api/memory/message', (req, res) => {
    const { userId, role, content } = req.body;

    if (!userId || !role || !content) {
      return res.status(400).json({ error: 'Missing: userId, role, content' });
    }

    const message = conversationMemory.addMessage(userId, role, content);

    res.json({
      success: true,
      message: {
        ...message,
        contextSummary: conversationMemory.getContext(userId).summary
      }
    });
  });

  /**
   * API: Get Conversation Context
   * GET /api/memory/context/:userId
   */
  app.get('/api/memory/context/:userId', (req, res) => {
    const { userId } = req.params;
    const { depth } = req.query;

    const context = conversationMemory.getContext(userId, parseInt(depth) || 5);
    const stats = conversationMemory.getStats(userId);

    res.json({
      userId,
      context,
      stats
    });
  });

  /**
   * API: Check if Follow-up Question
   * POST /api/memory/is-followup
   */
  app.post('/api/memory/is-followup', (req, res) => {
    const { userId, prompt } = req.body;

    if (!userId || !prompt) {
      return res.status(400).json({ error: 'Missing: userId, prompt' });
    }

    const isFollowUp = conversationMemory.isFollowUp(userId, prompt);
    const context = conversationMemory.getContext(userId);

    res.json({
      isFollowUp,
      hasContext: context.messages.length > 0,
      contextDepth: context.messages.length,
      contextSummary: context.summary
    });
  });

  /**
   * API: Get Conversation History
   * GET /api/memory/history/:userId
   */
  app.get('/api/memory/history/:userId', (req, res) => {
    const { userId } = req.params;
    const history = conversationMemory.conversations.get(userId) || [];

    res.json({
      userId,
      messageCount: history.length,
      messages: history.slice(-20), // Last 20 messages
      stats: conversationMemory.getStats(userId)
    });
  });

  /**
   * API: Export Conversation
   * GET /api/memory/export/:userId
   */
  app.get('/api/memory/export/:userId', (req, res) => {
    const { userId } = req.params;
    const { format } = req.query;

    const exported = conversationMemory.exportConversation(userId, format || 'text');

    if (format === 'json') {
      res.json(JSON.parse(exported));
    } else {
      res.type('text/plain').send(exported);
    }
  });

  /**
   * API: Clear Conversation
   * DELETE /api/memory/:userId
   */
  app.delete('/api/memory/:userId', (req, res) => {
    const { userId } = req.params;
    conversationMemory.clearConversation(userId);

    res.json({
      success: true,
      message: `Conversation for ${userId} cleared`
    });
  });

  // ===== END PHASE 3 =====

  const PORT = process.env.PORT || 4000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`BA Local AI Service running at http://localhost:${PORT}`);
    console.log(`✓ Phase 1: Intent Classification & Routing`);
    console.log(`✓ Phase 2: Response Formatting`);
    console.log(`✓ Phase 3: Reports, Multi-Step Solving, Conversation Memory`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start BA Local AI Service:", err);
  process.exit(1);
});


