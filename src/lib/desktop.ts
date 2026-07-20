import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Attachment, ProjectData } from "../types";
import { BARUN_EXTENSION, createBarunPackage, parseBarunPackage } from "./project-package";

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
    filters: [{ name: "바른장부 프로젝트", extensions: [BARUN_EXTENSION, "json"] }],
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

export async function chooseAttachments() {
  if (!isTauri()) return [];
  const selected = await open({
    directory: false,
    multiple: true,
    title: "영수증 또는 증빙 여러 개 선택",
    filters: [{ name: "영수증·증빙", extensions: ["png", "jpg", "jpeg", "webp", "pdf"] }],
  });
  return Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
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

const parentDirectory = (path: string) => path.replace(/[\\/][^\\/]+$/, "");

async function packageBytes(project: ProjectData) {
  return createBarunPackage(project, async (relativePath) => {
    if (!project.projectDirectory) throw new Error("첨부파일 작업 폴더가 준비되지 않았습니다.");
    return readAttachmentBytes(attachmentAbsolutePath(project.projectDirectory, relativePath));
  });
}

export async function writeAttachmentBytes(path: string, bytes: Uint8Array) {
  await invoke("write_binary_file", { path, bytes: Array.from(bytes) });
}

export async function deleteAttachmentFile(path: string) {
  if (!isTauri()) return;
  await invoke("delete_file_if_exists", { path });
}

async function prepareWorkspace(packagePath: string) {
  return invoke<string>("prepare_project_workspace", { packagePath });
}

async function extractAssets(bytes: Uint8Array, workspaceDirectory: string) {
  const parsed = await parseBarunPackage(bytes);
  for (const [relativePath, content] of parsed.assets) {
    await writeAttachmentBytes(`${workspaceDirectory}/${relativePath}`, content);
  }
  return parsed.project;
}

export async function saveProjectPackage(project: ProjectData, packagePath: string) {
  if (!isTauri()) {
    localStorage.setItem("accounting-assistant-project", JSON.stringify(project));
    return;
  }
  await writeAttachmentBytes(packagePath, await packageBytes(project));
}

export async function saveProjectPackageAs(project: ProjectData, defaultName: string) {
  if (!isTauri()) return null;
  const packagePath = await save({
    defaultPath: defaultName,
    filters: [{ name: "바른장부 프로젝트", extensions: [BARUN_EXTENSION] }],
  });
  if (!packagePath) return null;
  const bytes = await packageBytes(project);
  await writeAttachmentBytes(packagePath, bytes);
  const workspaceDirectory = await prepareWorkspace(packagePath);
  await extractAssets(bytes, workspaceDirectory);
  return { packagePath, project: { ...project, projectDirectory: workspaceDirectory } };
}

export async function openProjectDocument(path: string): Promise<{ project: ProjectData; packagePath?: string }> {
  if (path.toLowerCase().endsWith(".json")) {
    const project = JSON.parse(await loadProjectFile(path)) as ProjectData;
    return { project: { ...project, projectDirectory: project.projectDirectory || parentDirectory(path) } };
  }
  const bytes = new Uint8Array(await invoke<number[]>("read_binary_file", { path }));
  const workspaceDirectory = await prepareWorkspace(path);
  const portableProject = await extractAssets(bytes, workspaceDirectory);
  return { project: { ...portableProject, projectDirectory: workspaceDirectory }, packagePath: path } as { project: ProjectData; packagePath: string };
}

async function importAttachmentPath(projectDirectory: string, sourcePath: string): Promise<Attachment> {
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

export async function importAttachment(projectDirectory: string): Promise<Attachment | null> {
  const sourcePath = await chooseAttachment();
  return sourcePath ? importAttachmentPath(projectDirectory, sourcePath) : null;
}

export async function importAttachments(projectDirectory: string): Promise<Attachment[]> {
  const sourcePaths = await chooseAttachments();
  return Promise.all(sourcePaths.map((sourcePath) => importAttachmentPath(projectDirectory, sourcePath)));
}

export async function importClipboardAttachment(projectDirectory: string, file: File): Promise<Attachment> {
  if (!isTauri()) throw new Error("설치형 앱에서 클립보드 이미지를 프로젝트에 넣을 수 있습니다.");
  const mimeType = file.type || "image/png";
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const originalName = file.name && !file.name.startsWith("image.") ? file.name : `클립보드-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  const relativePath = `attachments/clipboard-${crypto.randomUUID()}.${extension}`;
  await writeAttachmentBytes(`${projectDirectory}/${relativePath}`, new Uint8Array(await file.arrayBuffer()));
  return { id: crypto.randomUUID(), relativePath, originalName, mimeType, kind: "online-receipt" };
}

export async function saveBinaryWithDialog(bytes: Uint8Array, defaultName: string, fileType: "excel" | "pdf" = "excel") {
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
    filters: [fileType === "pdf" ? { name: "PDF 문서", extensions: ["pdf"] } : { name: "Excel 통합문서", extensions: ["xlsx"] }],
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
