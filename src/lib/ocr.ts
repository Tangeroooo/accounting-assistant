import { createWorker, PSM } from "tesseract.js";
import { attachmentAbsolutePath, getClovaStatus, readAttachmentBytes, runClovaOcr } from "./desktop";
import type { Attachment } from "../types";

export interface OcrSuggestion {
  provider: "clova" | "tesseract";
  quality: "usable" | "partial" | "unreadable";
  date?: string;
  amount?: number;
  merchant?: string;
  rawText: string;
}

const findString = (value: unknown, preferredKeys: string[]): string | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of preferredKeys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      for (const nestedKey of ["formatted", "text", "value", "name"]) {
        const nestedValue = nested[nestedKey];
        if (typeof nestedValue === "string" && nestedValue.trim()) return nestedValue.trim();
        if (nestedValue && typeof nestedValue === "object") {
          const formatted = (nestedValue as Record<string, unknown>).value;
          if (typeof formatted === "string" && formatted.trim()) return formatted.trim();
        }
      }
    }
  }
  for (const child of Object.values(record)) {
    const result = findString(child, preferredKeys);
    if (result) return result;
  }
  return undefined;
};

const collectTexts = (value: unknown, output: string[] = []) => {
  if (Array.isArray(value)) {
    value.forEach((child) => collectTexts(child, output));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (["text", "inferText"].includes(key) && typeof child === "string") output.push(child);
      else collectTexts(child, output);
    }
  }
  return output;
};

const normalizeDate = (value?: string) => {
  if (!value) return undefined;
  const matches = [...value.matchAll(/(?:^|\D)((?:20)?\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?:\s*[일.]|\D|$)/g)];
  const match = matches.find((candidate) => candidate[1].length === 4) ?? matches[0];
  if (!match) return undefined;
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const normalizeAmount = (value?: string) => {
  if (!value) return undefined;
  const digits = value.replace(/[^0-9]/g, "");
  const number = Number(digits);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const fromClova = (response: unknown): OcrSuggestion => {
  const dateText = findString(response, ["paymentDate", "date", "paidDate"]);
  const amountText = findString(response, ["totalPrice", "totalAmount", "amount", "price"]);
  const merchant = findString(response, ["storeInfo", "name", "merchantName"]);
  const date = normalizeDate(dateText);
  const amount = normalizeAmount(amountText);
  const candidateCount = [date, amount, merchant].filter(Boolean).length;
  return {
    provider: "clova",
    quality: candidateCount >= 2 ? "usable" : candidateCount === 1 ? "partial" : "unreadable",
    date,
    amount,
    merchant,
    rawText: collectTexts(response).join("\n"),
  };
};

const cleanedLines = (rawText: string) => rawText
  .replace(/\r/g, "\n")
  .split(/\n+/)
  .map((line) => line.replace(/\s+/g, " ").trim())
  .filter(Boolean);

const merchantCandidate = (rawText: string) => cleanedLines(rawText)
  .map((line, index) => {
    const labeled = line.match(/(?:판매자\s*상호|가맹점명?|매장명|상호)\s*[:：-]?\s*(.+)$/i);
    const candidateLine = labeled?.[1]?.trim() || line;
    const compact = candidateLine.replace(/\s/g, "");
    const letters = candidateLine.match(/[A-Za-z가-힣]/g)?.length ?? 0;
    const digits = candidateLine.match(/\d/g)?.length ?? 0;
    const readableRatio = compact.length ? letters / compact.length : 0;
    const looksLikeMetadata = /(영수증|결제|승인|금액|합\s*계|총\s*액|부가세|공급가|사업자|대표자|전화|전표|카드|오전|오후|일시|의거|발행|적용|문의|정책|receipt|total|amount|date|time|tel)/i.test(candidateLine);
    const acceptable = compact.length >= 2
      && compact.length <= 42
      && letters >= 2
      && readableRatio >= 0.42
      && digits <= Math.max(6, letters)
      && !looksLikeMetadata;
    const lengthPenalty = Math.max(0, letters - 16) * 3;
    return { line: candidateLine, acceptable, score: (labeled ? 80 : 0) + Math.min(letters, 12) * 2 - lengthPenalty - digits * 1.5 - index * 0.15 };
  })
  .filter((candidate) => candidate.acceptable)
  .sort((left, right) => right.score - left.score)[0]?.line;

export const guessFromText = (input: string): OcrSuggestion => {
  const rawText = cleanedLines(input).join("\n");
  const date = normalizeDate(rawText);
  const amountCandidates = [...rawText.matchAll(/(?:합\s*계|총\s*액|결제\s*금액|청구\s*금액)[^0-9]{0,12}([0-9,]{3,})/g)]
    .map((match) => normalizeAmount(match[1]))
    .filter((value): value is number => Boolean(value));
  const fallbackAmounts = [...rawText.matchAll(/\b([0-9]{1,3}(?:,[0-9]{3})+)\s*원?\b/g)]
    .map((match) => normalizeAmount(match[1]))
    .filter((value): value is number => Boolean(value));
  const amount = amountCandidates[0] ?? (Math.max(0, ...fallbackAmounts) || undefined);
  const merchant = merchantCandidate(rawText);
  const candidateCount = [date, amount, merchant].filter(Boolean).length;
  return {
    provider: "tesseract",
    quality: candidateCount >= 2 ? "usable" : candidateCount === 1 ? "partial" : "unreadable",
    date,
    amount,
    merchant,
    rawText,
  };
};

export async function recognizeReceipt(
  projectDirectory: string,
  attachment: Attachment,
  onProgress?: (progress: number) => void,
): Promise<OcrSuggestion> {
  const absolutePath = attachmentAbsolutePath(projectDirectory, attachment.relativePath);
  const status = await getClovaStatus();
  if (status.configured) return fromClova(await runClovaOcr(absolutePath));
  if (attachment.mimeType === "application/pdf" || attachment.originalName.toLowerCase().endsWith(".pdf")) {
    throw new Error("PDF가 아직 이미지로 변환되지 않았습니다. 프로젝트를 다시 열거나 PDF를 다시 첨부해 주세요.");
  }

  const bytes = await readAttachmentBytes(absolutePath);
  const blob = new Blob([bytes as BlobPart], { type: attachment.mimeType });
  const worker = await createWorker("kor", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    gzip: true,
    cacheMethod: "write",
    logger: (message) => {
      if (typeof message.progress === "number") onProgress?.(message.progress);
    },
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    const result = await worker.recognize(blob, { rotateAuto: true });
    return guessFromText(result.data.text);
  } finally {
    await worker.terminate();
  }
}
