import { createWorker } from "tesseract.js";
import { attachmentAbsolutePath, getClovaStatus, readAttachmentBytes, runClovaOcr } from "./desktop";
import type { Attachment } from "../types";

export interface OcrSuggestion {
  provider: "clova" | "tesseract";
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
  const match = value.match(/(20\d{2})\D?(\d{1,2})\D?(\d{1,2})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
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
  return {
    provider: "clova",
    date: normalizeDate(dateText),
    amount: normalizeAmount(amountText),
    merchant,
    rawText: collectTexts(response).join("\n"),
  };
};

const guessFromText = (rawText: string): OcrSuggestion => {
  const date = normalizeDate(rawText);
  const amountCandidates = [...rawText.matchAll(/(?:합\s*계|총\s*액|결제\s*금액)[^0-9]{0,12}([0-9,]{3,})/g)]
    .map((match) => normalizeAmount(match[1]))
    .filter((value): value is number => Boolean(value));
  const fallbackAmounts = [...rawText.matchAll(/\b([0-9]{1,3}(?:,[0-9]{3})+)\s*원?\b/g)]
    .map((match) => normalizeAmount(match[1]))
    .filter((value): value is number => Boolean(value));
  return {
    provider: "tesseract",
    date,
    amount: amountCandidates[0] ?? (Math.max(0, ...fallbackAmounts) || undefined),
    merchant: rawText.split("\n").map((line) => line.trim()).find((line) => line.length >= 2),
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
    const result = await worker.recognize(blob);
    return guessFromText(result.data.text);
  } finally {
    await worker.terminate();
  }
}
