import type { ProjectData } from "../types";
import { collectProjectAssetPaths, createBarunPackage, parseBarunPackage } from "./project-package";

export const BROWSER_WORKSPACE = "browser://barun-workspace";

const DB_NAME = "barun-accounting-assistant";
const DB_VERSION = 2;
const STORE_NAME = "recovery";
const ASSET_STORE_NAME = "assets";
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
  if (lower.endsWith(".heic") || lower.endsWith(".heics")) return "image/heic";
  if (lower.endsWith(".heif") || lower.endsWith(".heifs")) return "image/heif";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

export async function browserWriteAsset(path: string, bytes: Uint8Array) {
  const relativePath = relativeAssetPath(path);
  const previousUrl = assetUrls.get(relativePath);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  assetUrls.delete(relativePath);
  if ("indexedDB" in window) {
    const ownedBuffer = new Uint8Array(bytes).buffer;
    await withStore(ASSET_STORE_NAME, "readwrite", (store) => store.put(ownedBuffer, relativePath));
    // 원본은 IndexedDB에 보관하고, 화면에서 실제로 요청한 축소 미리보기만
    // 메모리에 올립니다. 대용량 사진을 첨부한 직후의 메모리 급증을 막습니다.
    assets.delete(relativePath);
    return;
  }
  assets.set(relativePath, new Uint8Array(bytes));
}

export async function browserReadAsset(path: string, cache = true) {
  const relativePath = relativeAssetPath(path);
  let bytes = assets.get(relativePath);
  if (!bytes && "indexedDB" in window) {
    const stored = await withStore<ArrayBuffer | undefined>(ASSET_STORE_NAME, "readonly", (store) => store.get(relativePath));
    if (stored) {
      bytes = new Uint8Array(stored);
      if (cache) assets.set(relativePath, bytes);
    }
  }
  if (!bytes) throw new Error(`프로젝트에서 첨부파일을 찾을 수 없습니다: ${relativePath}`);
  return new Uint8Array(bytes);
}

export async function browserDeleteAsset(path: string) {
  const relativePath = relativeAssetPath(path);
  const previousUrl = assetUrls.get(relativePath);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  assetUrls.delete(relativePath);
  assets.delete(relativePath);
  if ("indexedDB" in window) {
    await withStore(ASSET_STORE_NAME, "readwrite", (store) => store.delete(relativePath));
  }
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

export async function replaceBrowserAssets(nextAssets: Map<string, Uint8Array>) {
  clearBrowserAssets();
  if (!("indexedDB" in window)) {
    nextAssets.forEach((bytes, path) => assets.set(path, new Uint8Array(bytes)));
    return;
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
      const store = transaction.objectStore(ASSET_STORE_NAME);
      store.clear();
      nextAssets.forEach((bytes, path) => store.put(new Uint8Array(bytes).buffer, path));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("첨부파일 저장소를 갱신하지 못했습니다."));
      transaction.onabort = () => reject(transaction.error ?? new Error("첨부파일 저장소 갱신이 취소되었습니다."));
    });
  } finally {
    database.close();
  }
}

export interface BrowserProjectAssetAudit {
  referencedPaths: string[];
  missingPaths: string[];
  orphanedPaths: string[];
}

export async function auditBrowserProjectAssets(project: ProjectData): Promise<BrowserProjectAssetAudit> {
  const referencedPaths = collectProjectAssetPaths(project).map(relativeAssetPath);
  const availablePaths = new Set(assets.keys());
  if ("indexedDB" in window) {
    const storedKeys = await withStore<IDBValidKey[]>(ASSET_STORE_NAME, "readonly", (store) => store.getAllKeys());
    storedKeys.forEach((key) => {
      if (typeof key === "string") availablePaths.add(relativeAssetPath(key));
    });
  }
  const referenced = new Set(referencedPaths);
  return {
    referencedPaths,
    missingPaths: referencedPaths.filter((path) => !availablePaths.has(path)),
    orphanedPaths: [...availablePaths].filter((path) => path.startsWith("attachments/") && !referenced.has(path)).sort(),
  };
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
  // 백업을 만들 때 모든 원본을 한 번씩 읽되 메모리 캐시에 남기지 않습니다.
  return createBarunPackage(project, (relativePath) => browserReadAsset(relativePath, false));
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      if (!request.result.objectStoreNames.contains(ASSET_STORE_NAME)) request.result.createObjectStore(ASSET_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("브라우저 저장소를 열지 못했습니다."));
  });
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let requestCompleted = false;
      let result: T;
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => {
        requestCompleted = true;
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error("브라우저 저장소 작업에 실패했습니다."));
      transaction.oncomplete = () => {
        if (requestCompleted) resolve(result);
        else reject(new Error("브라우저 저장소 작업이 완료되지 않았습니다."));
      };
      transaction.onerror = () => reject(transaction.error ?? new Error("브라우저 저장소 작업에 실패했습니다."));
      transaction.onabort = () => reject(transaction.error ?? new Error("브라우저 저장소 작업이 취소되었습니다."));
    });
  } finally {
    database.close();
  }
}

export async function saveBrowserRecoveryProject(project: ProjectData) {
  if (!("indexedDB" in window)) return;
  const { projectDirectory: _runtimeDirectory, ...portableProject } = project;
  await withStore(STORE_NAME, "readwrite", (store) => store.put(portableProject, CURRENT_PROJECT_KEY));
}

export async function loadBrowserRecoveryProject(): Promise<ProjectData | null> {
  if (!("indexedDB" in window)) return null;
  const stored = await withStore<ArrayBuffer | Omit<ProjectData, "projectDirectory"> | undefined>(STORE_NAME, "readonly", (store) => store.get(CURRENT_PROJECT_KEY));
  if (!stored) return null;
  if (stored instanceof ArrayBuffer) {
    const parsed = await parseBarunPackage(new Uint8Array(stored));
    await replaceBrowserAssets(parsed.assets);
    await saveBrowserRecoveryProject({ ...parsed.project, projectDirectory: BROWSER_WORKSPACE });
    return { ...parsed.project, projectDirectory: BROWSER_WORKSPACE };
  }
  return { ...stored, projectDirectory: BROWSER_WORKSPACE };
}

export async function clearBrowserRecoveryProject() {
  clearBrowserAssets();
  if (!("indexedDB" in window)) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME, ASSET_STORE_NAME], "readwrite");
      transaction.objectStore(STORE_NAME).delete(CURRENT_PROJECT_KEY);
      transaction.objectStore(ASSET_STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("브라우저 자동복구 자료를 지우지 못했습니다."));
      transaction.onabort = () => reject(transaction.error ?? new Error("브라우저 자동복구 자료 삭제가 취소되었습니다."));
    });
  } finally {
    database.close();
  }
}
