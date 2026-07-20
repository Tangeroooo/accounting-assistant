import type { ProjectData } from "../types";
import { createBarunPackage, parseBarunPackage } from "./project-package";

export const BROWSER_WORKSPACE = "browser://barun-workspace";

const DB_NAME = "barun-accounting-assistant";
const DB_VERSION = 1;
const STORE_NAME = "recovery";
const CURRENT_PROJECT_KEY = "current-project";

const assets = new Map<string, Uint8Array>();
const assetUrls = new Map<string, string>();
const pickedFiles = new Map<string, File>();

function relativeAssetPath(path: string) {
  const marker = "attachments/";
  const index = path.indexOf(marker);
  return index >= 0 ? path.slice(index) : path.replace(/^\/+/, "");
}

function mimeTypeForPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

export function browserWriteAsset(path: string, bytes: Uint8Array) {
  const relativePath = relativeAssetPath(path);
  const previousUrl = assetUrls.get(relativePath);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  assetUrls.delete(relativePath);
  assets.set(relativePath, new Uint8Array(bytes));
}

export function browserReadAsset(path: string) {
  const relativePath = relativeAssetPath(path);
  const bytes = assets.get(relativePath);
  if (!bytes) throw new Error(`프로젝트에서 첨부파일을 찾을 수 없습니다: ${relativePath}`);
  return new Uint8Array(bytes);
}

export function browserDeleteAsset(path: string) {
  const relativePath = relativeAssetPath(path);
  const previousUrl = assetUrls.get(relativePath);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  assetUrls.delete(relativePath);
  assets.delete(relativePath);
}

export function browserAssetUrl(path: string) {
  const relativePath = relativeAssetPath(path);
  const cached = assetUrls.get(relativePath);
  if (cached) return cached;
  const bytes = assets.get(relativePath);
  if (!bytes) return "";
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeTypeForPath(relativePath) }));
  assetUrls.set(relativePath, url);
  return url;
}

export function replaceBrowserAssets(nextAssets: Map<string, Uint8Array>) {
  clearBrowserAssets();
  nextAssets.forEach((bytes, path) => assets.set(path, new Uint8Array(bytes)));
}

export function clearBrowserAssets() {
  assetUrls.forEach((url) => URL.revokeObjectURL(url));
  assetUrls.clear();
  assets.clear();
}

export function registerPickedFile(file: File) {
  const token = `browser-file://${crypto.randomUUID()}`;
  pickedFiles.set(token, file);
  return token;
}

export function takePickedFile(token: string) {
  const file = pickedFiles.get(token);
  pickedFiles.delete(token);
  if (!file) throw new Error("선택한 파일을 읽을 수 없습니다. 다시 선택해 주세요.");
  return file;
}

export function pickBrowserFiles(accept: string, multiple = false) {
  return new Promise<string[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files.map(registerPickedFile));
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => finish([]), { once: true });
    window.addEventListener("focus", () => window.setTimeout(() => {
      if (!settled && !input.files?.length) finish([]);
    }, 400), { once: true });
    input.click();
  });
}

export function downloadBrowserFile(bytes: Uint8Array, fileName: string, mimeType = "application/octet-stream") {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function packageBytes(project: ProjectData) {
  return createBarunPackage(project, async (relativePath) => browserReadAsset(relativePath));
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("브라우저 저장소를 열지 못했습니다."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("브라우저 저장소 작업에 실패했습니다."));
    });
  } finally {
    database.close();
  }
}

export async function saveBrowserRecoveryProject(project: ProjectData) {
  if (!("indexedDB" in window)) return;
  const bytes = await packageBytes(project);
  const ownedBuffer = new Uint8Array(bytes).buffer;
  await withStore("readwrite", (store) => store.put(ownedBuffer, CURRENT_PROJECT_KEY));
}

export async function loadBrowserRecoveryProject(): Promise<ProjectData | null> {
  if (!("indexedDB" in window)) return null;
  const stored = await withStore<ArrayBuffer | undefined>("readonly", (store) => store.get(CURRENT_PROJECT_KEY));
  if (!stored) return null;
  const parsed = await parseBarunPackage(new Uint8Array(stored));
  replaceBrowserAssets(parsed.assets);
  return { ...parsed.project, projectDirectory: BROWSER_WORKSPACE };
}

export async function clearBrowserRecoveryProject() {
  clearBrowserAssets();
  if (!("indexedDB" in window)) return;
  await withStore("readwrite", (store) => store.delete(CURRENT_PROJECT_KEY));
}
