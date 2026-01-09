import { Agent, setGlobalDispatcher } from "undici";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_HEADERS_TIMEOUT_MS = Number(process.env.OLLAMA_HEADERS_TIMEOUT_MS || 900000);
const OLLAMA_BODY_TIMEOUT_MS = Number(process.env.OLLAMA_BODY_TIMEOUT_MS || 900000);
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "10m";

setGlobalDispatcher(
  new Agent({
    headersTimeout: OLLAMA_HEADERS_TIMEOUT_MS,
    bodyTimeout: OLLAMA_BODY_TIMEOUT_MS,
    connectTimeout: 30000
  })
);

export async function callOllamaGenerate({ model, prompt, options = {} }) {
  const payload = {
    model,
    prompt,
    stream: false,
    ...options
  };
  if (!Object.prototype.hasOwnProperty.call(payload, "keep_alive")) {
    payload.keep_alive = OLLAMA_KEEP_ALIVE;
  }

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Ollama API error (${response.status}): ${errorBody}`
    );
  }

  const data = await response.json();
  return data.response;
}

export async function callOllamaEmbed({ model, input }) {
  const payload = {
    model,
    prompt: input
  };

  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Ollama embeddings error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return data.embedding || [];
}

export function buildThinkingResultPrompt(userPrompt, extraSystemMessage = "", responseSpecInstruction = "") {
  let prompt = `Always reply with two top-level sections:

Thinking
- 3-8 brief bullets (plan + assumptions only)

Result
- Final answer only
`;

  if (extraSystemMessage) {
    prompt += `\n${extraSystemMessage}`;
  }

  if (responseSpecInstruction) {
    prompt += `\n${responseSpecInstruction}`;
  }

  prompt += `\n\nUser request:\n${userPrompt}`;

  return prompt;
}

export async function streamOllamaGenerate({ model, prompt, options = {}, signal, onToken, onDone }) {
  const payload = {
    model,
    prompt,
    stream: true,
    ...options
  };
  if (!Object.prototype.hasOwnProperty.call(payload, "keep_alive")) {
    payload.keep_alive = OLLAMA_KEEP_ALIVE;
  }

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${errorBody}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let tokenText = trimmed;

      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          tokenText = parsed.token || parsed.delta || parsed.response || "";
        } catch (err) {
          tokenText = trimmed;
        }
      }

      if (tokenText) {
        onToken?.(tokenText);
      }
    }
  }

  if (buffer.trim()) {
    let tokenText = buffer.trim();
    if (tokenText.startsWith("{")) {
      try {
        const parsed = JSON.parse(tokenText);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        tokenText = parsed.token || parsed.delta || parsed.response || "";
      } catch (err) {
        tokenText = buffer.trim();
      }
    }
    if (tokenText) {
      onToken?.(tokenText);
    }
  }

  onDone?.();
}
