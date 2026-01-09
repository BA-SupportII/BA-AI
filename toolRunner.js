import path from "path";
import { spawn } from "child_process";
import { extractTextFromFile } from "./documentIngest.js";

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_CODE_CHARS = 12000;
const SQL_CACHE_TTL_MS = 5 * 60 * 1000;
const sqlCache = new Map();
const SAFE_PYTHON_BUILTINS = [
  "abs", "all", "any", "bool", "dict", "enumerate", "filter", "float", "int",
  "len", "list", "map", "max", "min", "print", "range", "round", "set",
  "sorted", "str", "sum", "tuple", "zip"
];
const BLOCKED_JS_PATTERNS = [
  /\brequire\b/i,
  /\bprocess\b/i,
  /\bchild_process\b/i,
  /\bfs\b/i,
  /\bnet\b/i,
  /\bhttp\b/i,
  /\bhttps\b/i,
  /\bspawn\b/i,
  /\bexec\b/i
];
const BLOCKED_PYTHON_PATTERNS = [
  /\bimport\s+os\b/i,
  /\bimport\s+sys\b/i,
  /\bimport\s+subprocess\b/i,
  /\bimport\s+socket\b/i,
  /\bimport\s+requests\b/i,
  /\bfrom\s+os\b/i,
  /\bfrom\s+sys\b/i,
  /\bsubprocess\./i,
  /\bsocket\./i,
  /\bopen\s*\(/i,
  /\beval\s*\(/i,
  /\bexec\s*\(/i
];
const ALLOWED_INGEST_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".html",
  ".css",
  ".pdf",
  ".docx"
]);

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

function runPythonScript({ pythonPath, script, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, ["-c", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Python execution timed out."));
    }, timeoutMs || DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `Python exited with code ${code}`));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });

    if (payload) {
      child.stdin.write(payload);
    }
    child.stdin.end();
  });
}

function runNodeScript({ nodePath, script, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("JavaScript execution timed out."));
    }, timeoutMs || DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `Node exited with code ${code}`));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });

    if (payload) {
      child.stdin.write(payload);
    }
    child.stdin.end();
  });
}

function assertPythonSafe(code, safeMode) {
  if (!safeMode) return;
  const trimmed = String(code || "");
  for (const pattern of BLOCKED_PYTHON_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error("Unsafe Python detected. Disable safeMode to run this code.");
    }
  }
}

function assertJavaScriptSafe(code, safeMode) {
  if (!safeMode) return;
  const trimmed = String(code || "");
  for (const pattern of BLOCKED_JS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error("Unsafe JavaScript detected. Disable jsSafeMode to run this code.");
    }
  }
}

export async function runPython({ code, pythonPath = "python", timeoutMs, safeMode = true, maxChars = MAX_CODE_CHARS }) {
  if (!code || !code.trim()) {
    throw new Error("Missing python code.");
  }
  if (String(code).length > maxChars) {
    throw new Error(`Python code too large (>${maxChars} chars).`);
  }
  assertPythonSafe(code, safeMode);
  const script = `import sys, json, math\n` +
    `payload = json.loads(sys.stdin.read())\n` +
    `code = payload.get("code", "")\n` +
    `safe_mode = payload.get("safeMode", True)\n` +
    `globals_dict = {}\n` +
    `locals_dict = {}\n` +
    `if safe_mode:\n` +
    `  builtins_obj = __builtins__\n` +
    `  def _get_builtin(name):\n` +
    `    try:\n` +
    `      return builtins_obj[name]\n` +
    `    except Exception:\n` +
    `      return getattr(builtins_obj, name, None)\n` +
    `  allowed = {name: _get_builtin(name) for name in ${JSON.stringify(SAFE_PYTHON_BUILTINS)} if _get_builtin(name) is not None}\n` +
    `  globals_dict = {"__builtins__": allowed, "math": math}\n` +
    `exec(code, globals_dict, locals_dict)\n`;
  const payload = JSON.stringify({ code, safeMode });
  const result = await runPythonScript({ pythonPath, script, payload, timeoutMs });
  return result.stdout || result.stderr || "Execution completed.";
}

function hasWriteKeywords(query) {
  return /\b(insert|update|delete|drop|alter|create|replace|truncate|vacuum|attach|detach)\b/i.test(query || "");
}

function isReadOnlyQuery(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return false;
  if (/;/.test(trimmed)) return false;
  if (hasWriteKeywords(trimmed)) return false;
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("select") || lowered.startsWith("with") || lowered.startsWith("pragma") || lowered.startsWith("explain")) {
    return true;
  }
  return false;
}

function getSqlCache(key) {
  const entry = sqlCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > SQL_CACHE_TTL_MS) {
    sqlCache.delete(key);
    return null;
  }
  return entry.value;
}

function setSqlCache(key, value) {
  sqlCache.set(key, { value, timestamp: Date.now() });
}

export async function runJavaScript({
  code,
  nodePath = "node",
  timeoutMs = 2000,
  safeMode = true,
  maxChars = MAX_CODE_CHARS
}) {
  if (!code || !code.trim()) {
    throw new Error("Missing JavaScript code.");
  }
  if (String(code).length > maxChars) {
    throw new Error(`JavaScript code too large (>${maxChars} chars).`);
  }
  assertJavaScriptSafe(code, safeMode);
  const payload = JSON.stringify({ code, safeMode, timeoutMs });
  const script = `
const vm = require("vm");
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(input || "{}");
  const code = payload.code || "";
  const safeMode = payload.safeMode !== false;
  const timeoutMs = payload.timeoutMs || 2000;
  const output = [];
  const sandboxConsole = {
    log: (...args) => output.push(args.join(" ")),
    error: (...args) => output.push(args.join(" "))
  };
  const context = safeMode
    ? { console: sandboxConsole, Math }
    : { console: sandboxConsole, Math, require, process, Buffer, setTimeout, setInterval, clearTimeout, clearInterval };
  try {
    const script = new vm.Script(code);
    const result = script.runInNewContext(context, { timeout: timeoutMs });
    if (result !== undefined) output.push(String(result));
    process.stdout.write(output.join("\\n"));
  } catch (err) {
    process.stderr.write(String(err && err.message ? err.message : err));
    process.exit(1);
  }
});
`;
  const result = await runNodeScript({ nodePath, script, payload, timeoutMs: timeoutMs + 500 });
  return result.stdout || result.stderr || "Execution completed.";
}

export async function runTypeScript({
  code,
  nodePath = "node",
  timeoutMs = 2000,
  safeMode = true,
  maxChars = MAX_CODE_CHARS
}) {
  if (!code || !code.trim()) {
    throw new Error("Missing TypeScript code.");
  }
  if (String(code).length > maxChars) {
    throw new Error(`TypeScript code too large (>${maxChars} chars).`);
  }
  assertJavaScriptSafe(code, safeMode);
  const payload = JSON.stringify({ code, safeMode, timeoutMs });
  const script = `
const vm = require("vm");
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(input || "{}");
  const code = payload.code || "";
  const safeMode = payload.safeMode !== false;
  const timeoutMs = payload.timeoutMs || 2000;
  const output = [];
  let ts;
  try {
    ts = require("typescript");
  } catch (err) {
    process.stderr.write("TypeScript runtime not installed. Install 'typescript'.");
    process.exit(1);
  }
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 }
  }).outputText;
  const sandboxConsole = {
    log: (...args) => output.push(args.join(" ")),
    error: (...args) => output.push(args.join(" "))
  };
  const context = safeMode
    ? { console: sandboxConsole, Math }
    : { console: sandboxConsole, Math, require, process, Buffer, setTimeout, setInterval, clearTimeout, clearInterval };
  try {
    const script = new vm.Script(transpiled);
    const result = script.runInNewContext(context, { timeout: timeoutMs });
    if (result !== undefined) output.push(String(result));
    process.stdout.write(output.join("\\n"));
  } catch (err) {
    process.stderr.write(String(err && err.message ? err.message : err));
    process.exit(1);
  }
});
`;
  const result = await runNodeScript({ nodePath, script, payload, timeoutMs: timeoutMs + 500 });
  return result.stdout || result.stderr || "Execution completed.";
}

export async function runSqliteQuery({
  query,
  dbPath,
  pythonPath = "python",
  timeoutMs,
  allowWrite = false
}) {
  if (!query || !query.trim()) {
    throw new Error("Missing SQL query.");
  }
  if (!dbPath) {
    throw new Error("Missing sqlite database path.");
  }
  if (!allowWrite && !isReadOnlyQuery(query)) {
    throw new Error("Write queries are disabled (read-only mode). Remove write keywords or semicolons.");
  }
  const cacheKey = `${dbPath}::${query}`;
  if (!allowWrite) {
    const cached = getSqlCache(cacheKey);
    if (cached) return cached;
  }
  const payload = JSON.stringify({ dbPath, query });
  const script = `import json, sys, sqlite3\n` +
    `payload = json.loads(sys.stdin.read())\n` +
    `db = payload["dbPath"]\n` +
    `query = payload["query"]\n` +
    `conn = sqlite3.connect(db)\n` +
    `conn.row_factory = sqlite3.Row\n` +
    `cur = conn.cursor()\n` +
    `cur.execute(query)\n` +
    `rows = cur.fetchall()\n` +
    `result = [dict(row) for row in rows]\n` +
    `print(json.dumps(result))\n`;
  const result = await runPythonScript({
    pythonPath,
    script,
    payload,
    timeoutMs
  });
  const output = result.stdout || "[]";
  if (!allowWrite) {
    setSqlCache(cacheKey, output);
  }
  return output;
}

export async function getSqliteSchema({ dbPath, pythonPath = "python", timeoutMs }) {
  if (!dbPath) {
    throw new Error("Missing sqlite database path.");
  }
  const payload = JSON.stringify({ dbPath });
  const script = `import json, sys, sqlite3\n` +
    `payload = json.loads(sys.stdin.read())\n` +
    `db = payload["dbPath"]\n` +
    `conn = sqlite3.connect(db)\n` +
    `conn.row_factory = sqlite3.Row\n` +
    `cur = conn.cursor()\n` +
    `cur.execute("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view','index','trigger') AND name NOT LIKE 'sqlite_%'")\n` +
    `items = [dict(row) for row in cur.fetchall()]\n` +
    `tables = [item for item in items if item.get("type") == "table"]\n` +
    `schema = []\n` +
    `for table in tables:\n` +
    `  name = table.get("name")\n` +
    `  cur.execute(f"PRAGMA table_info('{name}')")\n` +
    `  cols = [dict(row) for row in cur.fetchall()]\n` +
    `  schema.append({"name": name, "columns": cols, "sql": table.get("sql")})\n` +
    `print(json.dumps({"schema": schema, "objects": items}))\n`;
  const result = await runPythonScript({ pythonPath, script, payload, timeoutMs });
  return result.stdout || "{}";
}

export async function runSympy({ code, pythonPath = "python", timeoutMs }) {
  if (!code || !code.trim()) {
    throw new Error("Missing sympy code.");
  }
  const payload = JSON.stringify({ code });
  const script = `import json, sys\n` +
    `payload = json.loads(sys.stdin.read())\n` +
    `code = payload.get("code", "")\n` +
    `try:\n` +
    `  import sympy as sp\n` +
    `except Exception as e:\n` +
    `  print("sympy not installed")\n` +
    `  sys.exit(0)\n` +
    `globals_dict = {"sp": sp}\n` +
    `locals_dict = {}\n` +
    `exec(code, globals_dict, locals_dict)\n`;
  const result = await runPythonScript({ pythonPath, script, payload, timeoutMs });
  return result.stdout || result.stderr || "Execution completed.";
}

function detectLanguage(code) {
  const text = String(code || "");
  if (/```python/i.test(text) || /\bdef\s+\w+\(/.test(text)) return "python";
  if (/```(js|javascript)/i.test(text) || /\bconsole\.log\b/.test(text)) return "javascript";
  if (/```(ts|typescript)/i.test(text) || /\binterface\s+\w+/.test(text)) return "typescript";
  if (/```sql/i.test(text) || /\bselect\b/i.test(text)) return "sql";
  if (/```html/i.test(text) || /<html[\s>]/i.test(text)) return "html";
  if (/```css/i.test(text) || /{\s*[^}]+:\s*[^}]+}/.test(text)) return "css";
  return "plain";
}

export function analyzeCode(input) {
  const text = String(input || "");
  const code = text.replace(/```[\w-]*\s*|\s*```/g, "").trim();
  const lines = code ? code.split(/\r?\n/) : [];
  const hasTodo = /\bTODO\b|\bFIXME\b/i.test(code);
  const hasSecrets = /\bAKIA[0-9A-Z]{16}\b|-----BEGIN (RSA|PRIVATE) KEY-----/i.test(code);
  const language = detectLanguage(text);
  return {
    language,
    lineCount: lines.length,
    charCount: code.length,
    hasTodo,
    hasPotentialSecrets: hasSecrets,
    hasLongLines: lines.some((line) => line.length > 120)
  };
}

export async function summarizeText(input, maxSentences = 3) {
  const text = String(input || "").trim();
  if (!text) return "";
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => /^[-*]\s+/.test(line) || /^\d+[\).]\s+/.test(line));
  const picks = (bullets.length > 0 ? bullets : lines).slice(0, maxSentences);
  const summary = picks
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[\).]\s+/, ""))
    .join("; ");
  return summary || text.slice(0, 300);
}

export async function executeCode({
  code,
  language,
  pythonPath = "python",
  nodePath = "node",
  timeoutMs,
  safeMode = true,
  maxChars = MAX_CODE_CHARS,
  jsSafeMode = true,
  jsTimeoutMs = 2000
}) {
  const resolvedLanguage = String(language || "").toLowerCase() || detectLanguage(code);
  if (resolvedLanguage === "python") {
    return runPython({ code, pythonPath, timeoutMs, safeMode, maxChars });
  }
  if (resolvedLanguage === "javascript") {
    return runJavaScript({ code, nodePath, timeoutMs: jsTimeoutMs, safeMode: jsSafeMode, maxChars });
  }
  if (resolvedLanguage === "typescript") {
    return runTypeScript({ code, nodePath, timeoutMs: jsTimeoutMs, safeMode: jsSafeMode, maxChars });
  }
  throw new Error(`Unsupported language for code_execute: ${resolvedLanguage}`);
}

export async function ingestDocument({ projectRoot, filePath }) {
  const safePath = resolveSafePath(projectRoot, filePath);
  if (!safePath) {
    throw new Error("File path is outside the project.");
  }
  const ext = path.extname(safePath).toLowerCase();
  if (!ALLOWED_INGEST_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type: ${ext || "unknown"}`);
  }
  const text = await extractTextFromFile(safePath);
  return {
    path: path.relative(projectRoot, safePath),
    text
  };
}

export function parseToolCommand(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("/python") || trimmed.toLowerCase().startsWith("python:")) {
    return { tool: "python", input: trimmed.replace(/^\/?python\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/execute") || trimmed.toLowerCase().startsWith("execute:")) {
    return { tool: "code_execute", input: trimmed.replace(/^\/?execute\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/analyze") || trimmed.toLowerCase().startsWith("analyze:")) {
    return { tool: "code_analysis", input: trimmed.replace(/^\/?analyze\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/summarize") || trimmed.toLowerCase().startsWith("summarize:")) {
    return { tool: "summarize", input: trimmed.replace(/^\/?summarize\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/sql") || trimmed.toLowerCase().startsWith("sql:")) {
    return { tool: "sql", input: trimmed.replace(/^\/?sql\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/schema") || trimmed.toLowerCase().startsWith("schema:")) {
    return { tool: "sql_schema", input: trimmed.replace(/^\/?schema\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/ingest") || trimmed.toLowerCase().startsWith("ingest:")) {
    return { tool: "ingest", input: trimmed.replace(/^\/?ingest\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/search") || trimmed.toLowerCase().startsWith("search:")) {
    return { tool: "search", input: trimmed.replace(/^\/?search\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/fetch") || trimmed.toLowerCase().startsWith("fetch:")) {
    return { tool: "fetch", input: trimmed.replace(/^\/?fetch\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/url") || trimmed.toLowerCase().startsWith("url:")) {
    return { tool: "url", input: trimmed.replace(/^\/?url\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/visualize") || trimmed.toLowerCase().startsWith("visualize:")) {
    return { tool: "visualize", input: trimmed.replace(/^\/?visualize\s*:?\s*/i, "") };
  }
  if (trimmed.startsWith("/sympy") || trimmed.toLowerCase().startsWith("sympy:")) {
    return { tool: "sympy", input: trimmed.replace(/^\/?sympy\s*:?\s*/i, "") };
  }
  return null;
}
