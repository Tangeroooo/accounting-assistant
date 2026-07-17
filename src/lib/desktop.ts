import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Attachment } from "../types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function chooseProjectDirectory() {
  if (!isTauri()) return null;
  const selected = await open({ directory: true, multiple: false, title: "회계 프로젝트 폴더 선택" });
  return typeof selected === "string" ? selected : null;
}

export async function chooseProjectFile() {
  if (!isTauri()) return null;
  const selected = await open({
    directory: false,
    multiple: false,
    title: "회계 프로젝트 열기",
    filters: [{ name: "회계 프로젝트", extensions: ["json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseAttachment() {
  if (!isTauri()) return null;
  const selected = await open({
    directory: false,
    multiple: false,
    title: "영수증 또는 증빙 선택",
    filters: [{ name: "영수증·증빙", extensions: ["png", "jpg", "jpeg", "webp", "pdf"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function saveProjectFile(projectDirectory: string, content: string) {
  if (!isTauri()) {
    localStorage.setItem("accounting-assistant-project", content);
    return;
  }
  await invoke("save_project", {
    path: `${projectDirectory}/회계프로젝트.json`,
    content,
  });
}

export async function loadProjectFile(path: string) {
  if (!isTauri()) return localStorage.getItem("accounting-assistant-project") ?? "";
  return invoke<string>("load_project", { path });
}

export async function importAttachment(projectDirectory: string): Promise<Attachment | null> {
  const sourcePath = await chooseAttachment();
  if (!sourcePath) return null;
  const copied = await invoke<{
    absolutePath: string;
    relativePath: string;
    originalName: string;
  }>("copy_attachment", { sourcePath, projectDir: projectDirectory });
  const extension = copied.originalName.split(".").pop()?.toLowerCase();
  return {
    id: crypto.randomUUID(),
    relativePath: copied.relativePath,
    originalName: copied.originalName,
    mimeType:
      extension === "pdf"
        ? "application/pdf"
        : extension === "png"
          ? "image/png"
          : extension === "webp"
            ? "image/webp"
            : "image/jpeg",
    kind: "online-receipt",
  };
}

export async function saveBinaryWithDialog(bytes: Uint8Array, defaultName: string) {
  if (!isTauri()) {
    const blob = new Blob([bytes as BlobPart]);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultName;
    anchor.click();
    URL.revokeObjectURL(url);
    return null;
  }
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "Excel 통합문서", extensions: ["xlsx"] }],
  });
  if (!path) return null;
  await invoke("write_binary_file", { path, bytes: Array.from(bytes) });
  return path;
}

export async function readAttachmentBytes(absolutePath: string) {
  if (!isTauri()) throw new Error("브라우저 미리보기에서는 로컬 첨부파일을 읽을 수 없습니다.");
  return new Uint8Array(await invoke<number[]>("read_binary_file", { path: absolutePath }));
}

export interface ClovaStatus {
  configured: boolean;
  invokeUrl?: string;
}

export const getClovaStatus = async (): Promise<ClovaStatus> => {
  if (!isTauri()) return { configured: false };
  return invoke("clova_status");
};

export const saveClovaConfig = async (invokeUrl: string, secret: string) => {
  if (!isTauri()) throw new Error("설치형 앱에서 설정할 수 있습니다.");
  return invoke("save_clova_config", { invokeUrl, secret });
};

export const clearClovaConfig = async () => {
  if (!isTauri()) return;
  return invoke("clear_clova_config");
};

export const runClovaOcr = async (absolutePath: string) => {
  if (!isTauri()) throw new Error("설치형 앱에서 CLOVA OCR을 사용할 수 있습니다.");
  return invoke<unknown>("clova_ocr", { filePath: absolutePath });
};

export const attachmentAbsolutePath = (projectDirectory: string, relativePath: string) =>
  `${projectDirectory}/${relativePath}`;

export const attachmentAssetUrl = (projectDirectory: string, relativePath: string) => {
  const path = attachmentAbsolutePath(projectDirectory, relativePath);
  return isTauri() ? convertFileSrc(path) : "";
};
