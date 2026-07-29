import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { Attachment, ProjectData } from "../types";
import {
  attachmentAbsolutePath,
  deleteAttachmentFile,
  readAttachmentBytes,
  writeAttachmentBytes,
} from "./desktop";
import { attachmentRenderAsset } from "./attachment-assets";
import { DEFAULT_IMAGE_LAYOUT } from "./receipt-book";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PREVIEW_MAX_EDGE = 1600;
const PREVIEW_JPEG_QUALITY = 0.82;
const HEIF_RENDER_JPEG_QUALITY = 0.92;

function canvasImageBytes(canvas: HTMLCanvasElement, mimeType: "image/png" | "image/jpeg", quality?: number) {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("첨부 이미지를 변환하지 못했습니다."));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, mimeType, quality);
  });
}

function baseName(fileName: string) {
  return fileName.replace(/\.(?:pdf|heic|heif|heics|heifs)$/i, "").trim() || "영수증";
}

function pdfJsAssetDirectory(directory: "cmaps" | "standard_fonts") {
  return new URL(`${import.meta.env.BASE_URL}pdfjs/${directory}/`, window.location.href).href;
}

export function isHeifAttachment(attachment: Pick<Attachment, "mimeType" | "originalName">) {
  return /^image\/hei(?:c|f)(?:-sequence)?$/i.test(attachment.mimeType)
    || /\.(?:heic|heif|heics|heifs)$/i.test(attachment.originalName);
}

export function attachmentNeedsImageNormalization(attachment: Pick<Attachment, "mimeType" | "originalName" | "renderRelativePath">) {
  return attachment.mimeType === "application/pdf"
    || attachment.originalName.toLowerCase().endsWith(".pdf")
    || (isHeifAttachment(attachment) && !attachment.renderRelativePath);
}

export function attachmentNeedsImagePreparation(attachment: Pick<Attachment, "mimeType" | "originalName" | "renderRelativePath" | "previewPrepared">) {
  return attachmentNeedsImageNormalization(attachment) || !attachment.previewPrepared;
}

async function imagePreviewBytes(bytes: Uint8Array, mimeType: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const largestEdge = Math.max(image.naturalWidth, image.naturalHeight);
    if (largestEdge <= PREVIEW_MAX_EDGE) return null;
    const scale = PREVIEW_MAX_EDGE / largestEdge;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasImageBytes(canvas, "image/jpeg", PREVIEW_JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepareAttachmentPreview(projectDirectory: string, attachment: Attachment) {
  if (attachment.previewPrepared) return attachment;
  const renderAsset = attachmentRenderAsset(attachment);
  if (!/^image\/(?:png|jpe?g|webp)$/i.test(renderAsset.mimeType)) {
    return { ...attachment, previewPrepared: true };
  }
  const previewRelativePath = `attachments/preview-${crypto.randomUUID()}.jpg`;
  const previewPath = attachmentAbsolutePath(projectDirectory, previewRelativePath);
  try {
    const previewBytes = await imagePreviewBytes(
      await readAttachmentBytes(attachmentAbsolutePath(projectDirectory, renderAsset.relativePath), false),
      renderAsset.mimeType,
    );
    if (!previewBytes) return { ...attachment, previewPrepared: true };
    await writeAttachmentBytes(previewPath, previewBytes);
    return {
      ...attachment,
      previewRelativePath,
      previewMimeType: "image/jpeg",
      previewPrepared: true,
    };
  } catch {
    await deleteAttachmentFile(previewPath);
    return { ...attachment, previewPrepared: true };
  }
}

async function normalizeHeifAttachment(projectDirectory: string, attachment: Attachment) {
  const sourcePath = attachmentAbsolutePath(projectDirectory, attachment.relativePath);
  const renderRelativePath = `attachments/heif-render-${crypto.randomUUID()}.jpg`;
  const generatedPath = attachmentAbsolutePath(projectDirectory, renderRelativePath);
  try {
    const { heicTo, isHeic } = await import("heic-to/csp");
    const sourceBytes = await readAttachmentBytes(sourcePath, false);
    const sourceFile = new File([sourceBytes as BlobPart], attachment.originalName, {
      type: attachment.mimeType || "image/heif",
    });
    if (!await isHeic(sourceFile)) throw new Error("HEIF 이미지 형식을 확인하지 못했습니다.");
    const converted = await heicTo({ blob: sourceFile, type: "image/jpeg", quality: HEIF_RENDER_JPEG_QUALITY });
    await writeAttachmentBytes(generatedPath, new Uint8Array(await converted.arrayBuffer()));
    return [await prepareAttachmentPreview(projectDirectory, {
      ...attachment,
      renderRelativePath,
      renderMimeType: "image/jpeg",
      layout: attachment.layout ?? { ...DEFAULT_IMAGE_LAYOUT },
    })];
  } catch (error) {
    await deleteAttachmentFile(generatedPath);
    throw new Error(`HEIF 이미지를 변환하지 못했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
  }
}

export async function normalizeAttachmentToImages(
  projectDirectory: string,
  attachment: Attachment,
): Promise<Attachment[]> {
  if (isHeifAttachment(attachment) && !attachment.renderRelativePath) return normalizeHeifAttachment(projectDirectory, attachment);
  if (attachment.mimeType !== "application/pdf" && !attachment.originalName.toLowerCase().endsWith(".pdf")) {
    return [await prepareAttachmentPreview(projectDirectory, attachment)];
  }

  const sourcePath = attachmentAbsolutePath(projectDirectory, attachment.relativePath);
  const generatedPaths: string[] = [];
  let loadingTask: ReturnType<typeof getDocument> | undefined;
  try {
    loadingTask = getDocument({
      data: await readAttachmentBytes(sourcePath, false),
      cMapUrl: pdfJsAssetDirectory("cmaps"),
      cMapPacked: true,
      standardFontDataUrl: pdfJsAssetDirectory("standard_fonts"),
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    const images: Attachment[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const initial = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.5, 1800 / initial.width) });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PDF 페이지를 이미지로 그릴 수 없습니다.");
      await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;

      const relativePath = `attachments/pdf-${crypto.randomUUID()}-page-${pageNumber}.png`;
      await writeAttachmentBytes(
        attachmentAbsolutePath(projectDirectory, relativePath),
        await canvasImageBytes(canvas, "image/png"),
      );
      generatedPaths.push(relativePath);
      const image = await prepareAttachmentPreview(projectDirectory, {
        id: crypto.randomUUID(),
        relativePath,
        originalName: `${baseName(attachment.originalName)}-${pageNumber}페이지.png`,
        mimeType: "image/png",
        kind: attachment.kind,
        layout: {
          ...DEFAULT_IMAGE_LAYOUT,
          aspectRatio: viewport.width / viewport.height,
        },
      });
      if (image.previewRelativePath) generatedPaths.push(image.previewRelativePath);
      images.push(image);
    }
    await deleteAttachmentFile(sourcePath);
    return images;
  } catch (error) {
    await Promise.all(generatedPaths.map((path) => deleteAttachmentFile(attachmentAbsolutePath(projectDirectory, path))));
    throw error;
  } finally {
    await loadingTask?.destroy();
  }
}

export interface ProjectPdfMigrationResult {
  project: ProjectData;
  convertedPdfCount: number;
  convertedHeifCount: number;
  generatedImageCount: number;
  preparedAttachmentCount: number;
  generatedPreviewCount: number;
  failures: string[];
}

export async function normalizeProjectAttachmentsToImages(project: ProjectData): Promise<ProjectPdfMigrationResult> {
  if (!project.projectDirectory) {
    return { project, convertedPdfCount: 0, convertedHeifCount: 0, generatedImageCount: 0, preparedAttachmentCount: 0, generatedPreviewCount: 0, failures: [] };
  }

  let convertedPdfCount = 0;
  let convertedHeifCount = 0;
  let generatedImageCount = 0;
  let preparedAttachmentCount = 0;
  let generatedPreviewCount = 0;
  const failures: string[] = [];
  const normalizeList = async (attachments: Attachment[]) => {
    const normalized: Attachment[] = [];
    for (const attachment of attachments) {
      const isPdf = attachment.mimeType === "application/pdf" || attachment.originalName.toLowerCase().endsWith(".pdf");
      const isHeif = isHeifAttachment(attachment) && !attachment.renderRelativePath;
      if (!attachmentNeedsImagePreparation(attachment)) {
        normalized.push(attachment);
        continue;
      }
      try {
        const images = await normalizeAttachmentToImages(project.projectDirectory!, attachment);
        normalized.push(...images);
        if (isPdf) convertedPdfCount += 1;
        if (isHeif) convertedHeifCount += 1;
        if (isPdf || isHeif) generatedImageCount += images.length;
        preparedAttachmentCount += 1;
        generatedPreviewCount += images.filter((image) => image.previewRelativePath && image.previewRelativePath !== attachment.previewRelativePath).length;
      } catch (error) {
        normalized.push(attachment);
        failures.push(`${attachment.originalName}: ${error instanceof Error ? error.message : "이미지 변환 실패"}`);
      }
    }
    return normalized;
  };

  const expenses = [] as ProjectData["expenses"];
  for (const expense of project.expenses) {
    expenses.push({ ...expense, attachments: await normalizeList(expense.attachments) });
  }
  const categoryEvidence = [] as ProjectData["categoryEvidence"];
  for (const evidence of project.categoryEvidence) {
    categoryEvidence.push({ ...evidence, attachments: await normalizeList(evidence.attachments) });
  }

  return {
    project: { ...project, expenses, categoryEvidence },
    convertedPdfCount,
    convertedHeifCount,
    generatedImageCount,
    preparedAttachmentCount,
    generatedPreviewCount,
    failures,
  };
}
