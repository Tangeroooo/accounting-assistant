import JSZip from "jszip";

import type { ProjectData } from "../types";

export const BARUN_FORMAT = "barun-accounting-project";
export const BARUN_FORMAT_VERSION = 1;
export const BARUN_EXTENSION = "barun";

interface BarunManifest {
  format: typeof BARUN_FORMAT;
  formatVersion: typeof BARUN_FORMAT_VERSION;
  savedAt: string;
  project: Omit<ProjectData, "projectDirectory">;
}

export interface ParsedBarunPackage {
  project: Omit<ProjectData, "projectDirectory">;
  assets: Map<string, Uint8Array>;
}

export function collectProjectAssetPaths(project: ProjectData) {
  return [...new Set([
    ...project.expenses.flatMap((expense) => expense.attachments.map((attachment) => attachment.relativePath)),
    ...project.categoryEvidence.flatMap((evidence) => evidence.attachments.map((attachment) => attachment.relativePath)),
  ])].filter((path) => path.startsWith("attachments/") && !path.includes(".."));
}

export async function createBarunPackage(
  project: ProjectData,
  readAsset: (relativePath: string) => Promise<Uint8Array>,
) {
  const zip = new JSZip();
  const { projectDirectory: _runtimeDirectory, ...portableProject } = project;
  const manifest: BarunManifest = {
    format: BARUN_FORMAT,
    formatVersion: BARUN_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    project: portableProject,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  for (const relativePath of collectProjectAssetPaths(project)) {
    zip.file(relativePath, await readAsset(relativePath));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function parseBarunPackage(bytes: Uint8Array): Promise<ParsedBarunPackage> {
  const zip = await JSZip.loadAsync(bytes);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("아웃리치 회계 프로젝트의 manifest.json이 없습니다.");
  const manifest = JSON.parse(await manifestFile.async("string")) as Partial<BarunManifest>;
  if (manifest.format !== BARUN_FORMAT || manifest.formatVersion !== BARUN_FORMAT_VERSION || !manifest.project) {
    throw new Error("지원하지 않는 아웃리치 회계 프로젝트 형식입니다.");
  }
  const assets = new Map<string, Uint8Array>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.startsWith("attachments/") || entry.name.includes("..")) continue;
    assets.set(entry.name, await entry.async("uint8array"));
  }
  const missingAssets = collectProjectAssetPaths(manifest.project as ProjectData)
    .filter((relativePath) => !assets.has(relativePath));
  if (missingAssets.length > 0) {
    throw new Error(`아웃리치 회계 프로젝트에서 첨부 이미지 ${missingAssets.length}개를 찾을 수 없습니다.`);
  }
  return { project: manifest.project, assets };
}
