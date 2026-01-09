import path from "path";
import { promises as fs } from "fs";

const MAX_DOC_CHARS = 120000;

async function readTextFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.slice(0, MAX_DOC_CHARS);
}

async function parsePdf(filePath) {
  const buffer = await fs.readFile(filePath);
  const pdfParse = await import("pdf-parse");
  const data = await pdfParse.default(buffer);
  return String(data.text || "").slice(0, MAX_DOC_CHARS);
}

async function parseDocx(filePath) {
  const buffer = await fs.readFile(filePath);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return String(result.value || "").slice(0, MAX_DOC_CHARS);
}

export async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) {
    return `Image file (${path.basename(filePath)}). OCR not enabled.`;
  }
  if (ext === ".pdf") {
    return parsePdf(filePath);
  }
  if (ext === ".docx") {
    return parseDocx(filePath);
  }
  return readTextFile(filePath);
}
