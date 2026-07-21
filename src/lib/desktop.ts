import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Attachment, ProjectData } from "../types";
import {
  BROWSER_WORKSPACE,
  browserAssetUrl,
  browserDeleteAsset,
  browserReadAsset,
  browserWriteAsset,
  clearBrowserRecoveryProject,
  downloadBrowserFile,
  loadBrowserRecoveryProject,
  pickBrowserFiles,
  replaceBrowserAssets,
  saveBrowserRecoveryProject,
  takePickedFile,
} from "./browser-project-store";
import { BARUN_EXTENSION, createBarunPackage, parseBarunPackage } from "./project-package";

export { BROWSER_WORKSPACE, clearBrowserRecoveryProject, loadBrowserRecoveryProject, saveBrowserRecoveryProject };

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function chooseProjectDirectory() {
  if (!isTauri()) return null;
  const selected = await open({ directory: true, multiple: false, title: "회계 프로젝트 폴더 선택" });
  return typeof selected === "string" ? selected : null;
}

export async function chooseProjectFile() {
  if (!isTauri()) return (await pickBrowserFiles(".barun,.json,application/json,application/zip"))[0] ?? null;
  const selected = await open({
    directory: false,
    multiple: false,
    title: "회계 프로젝트 열기",
    filters: [{ name: "아웃리치 회계 프로젝트", extensions: [BARUN_EXTENSION, "json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseAttachment() {
  if (!isTauri()) return (await pickBrowserFiles("image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf"))[0] ?? null;
  const selected = await open({
    directory: false,
    multiple: false,
    title: "영수증 또는 증빙 선택",
    filters: [{ name: "영수증·증빙", extensions: ["png", "jpg", "jpeg", "webp", "pdf"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseAttachments() {
  if (!isTauri()) return pickBrowserFiles("image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf", true);
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
  if (!isTauri()) {
    browserWriteAsset(path, bytes);
    return;
  }
  await invoke("write_binary_file", { path, bytes: Array.from(bytes) });
}

export async function deleteAttachmentFile(path: string) {
  if (!isTauri()) {
    browserDeleteAsset(path);
    return;
  }
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
    downloadBrowserFile(await packageBytes(project), packagePath.split(/[\\/]/).pop() || "회계 프로젝트.barun");
    return;
  }
  await writeAttachmentBytes(packagePath, await packageBytes(project));
}

export async function backupProjectPackageForUpdate(packagePath: string) {
  if (!isTauri()) return null;
  return invoke<string>("backup_project_file", { path: packagePath });
}

export async function saveProjectPackageAs(project: ProjectData, defaultName: string) {
  if (!isTauri()) {
    const browserProject = { ...project, projectDirectory: BROWSER_WORKSPACE };
    downloadBrowserFile(await packageBytes(browserProject), defaultName);
    return { project: browserProject, packagePath: undefined };
  }
  const packagePath = await save({
    defaultPath: defaultName,
    filters: [{ name: "아웃리치 회계 프로젝트", extensions: [BARUN_EXTENSION] }],
  });
  if (!packagePath) return null;
  const bytes = await packageBytes(project);
  await writeAttachmentBytes(packagePath, bytes);
  const workspaceDirectory = await prepareWorkspace(packagePath);
  await extractAssets(bytes, workspaceDirectory);
  return { packagePath, project: { ...project, projectDirectory: workspaceDirectory } };
}

export async function openProjectDocument(path: string): Promise<{ project: ProjectData; packagePath?: string; sourceFormat: "barun" | "json" }> {
  if (!isTauri()) {
    const file = takePickedFile(path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".json")) {
      const project = JSON.parse(new TextDecoder().decode(bytes)) as ProjectData;
      replaceBrowserAssets(new Map());
      return { project: { ...project, projectDirectory: BROWSER_WORKSPACE }, sourceFormat: "json" };
    }
    const parsed = await parseBarunPackage(bytes);
    replaceBrowserAssets(parsed.assets);
    return { project: { ...parsed.project, projectDirectory: BROWSER_WORKSPACE }, sourceFormat: "barun" };
  }
  if (path.toLowerCase().endsWith(".json")) {
    const project = JSON.parse(await loadProjectFile(path)) as ProjectData;
    return { project: { ...project, projectDirectory: project.projectDirectory || parentDirectory(path) }, sourceFormat: "json" };
  }
  const bytes = new Uint8Array(await invoke<number[]>("read_binary_file", { path }));
  const workspaceDirectory = await prepareWorkspace(path);
  const portableProject = await extractAssets(bytes, workspaceDirectory);
  return { project: { ...portableProject, projectDirectory: workspaceDirectory }, packagePath: path, sourceFormat: "barun" };
}

async function importAttachmentPath(projectDirectory: string, sourcePath: string): Promise<Attachment> {
  if (!isTauri()) {
    const file = takePickedFile(sourcePath);
    const extension = file.name.split(".").pop()?.toLowerCase();
    const mimeType = file.type || (extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg");
    const safeName = file.name.replace(/[^0-9A-Za-z가-힣._-]+/g, "-");
    const relativePath = `attachments/file-${crypto.randomUUID()}-${safeName}`;
    browserWriteAsset(relativePath, new Uint8Array(await file.arrayBuffer()));
    return { id: crypto.randomUUID(), relativePath, originalName: file.name, mimeType, kind: "online-receipt" };
  }
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
  const mimeType = file.type || "image/png";
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const originalName = file.name && !file.name.startsWith("image.") ? file.name : `클립보드-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  const relativePath = `attachments/clipboard-${crypto.randomUUID()}.${extension}`;
  await writeAttachmentBytes(`${projectDirectory}/${relativePath}`, new Uint8Array(await file.arrayBuffer()));
  return { id: crypto.randomUUID(), relativePath, originalName, mimeType, kind: "online-receipt" };
}

export async function saveBinaryWithDialog(bytes: Uint8Array, defaultName: string, fileType: "excel" | "pdf" | "docx" = "excel") {
  if (!isTauri()) {
    const mimeType = fileType === "pdf"
      ? "application/pdf"
      : fileType === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    downloadBrowserFile(bytes, defaultName, mimeType);
    return defaultName;
  }
  const path = await save({
    defaultPath: defaultName,
    filters: [fileType === "pdf"
      ? { name: "PDF 문서", extensions: ["pdf"] }
      : fileType === "docx"
        ? { name: "Microsoft Word 문서", extensions: ["docx"] }
        : { name: "Excel 통합문서", extensions: ["xlsx"] }],
  });
  if (!path) return null;
  await invoke("write_binary_file", { path, bytes: Array.from(bytes) });
  return path;
}

export async function readAttachmentBytes(absolutePath: string) {
  if (!isTauri()) return browserReadAsset(absolutePath);
  return new Uint8Array(await invoke<number[]>("read_binary_file", { path: absolutePath }));
}

export const attachmentAbsolutePath = (projectDirectory: string, relativePath: string) =>
  `${projectDirectory}/${relativePath}`;

export const attachmentAssetUrl = (projectDirectory: string, relativePath: string) => {
  const path = attachmentAbsolutePath(projectDirectory, relativePath);
  return isTauri() ? convertFileSrc(path) : browserAssetUrl(path);
};
