import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { Attachment, ProjectData } from "../types";
import {
  attachmentAbsolutePath,
  deleteAttachmentFile,
  readAttachmentBytes,
  writeAttachmentBytes,
} from "./desktop";
import { DEFAULT_IMAGE_LAYOUT } from "./receipt-book";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function canvasPngBytes(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("PDF 페이지를 PNG 이미지로 만들지 못했습니다."));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function baseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").trim() || "영수증";
}

export async function normalizeAttachmentToImages(
  projectDirectory: string,
  attachment: Attachment,
): Promise<Attachment[]> {
  if (attachment.mimeType !== "application/pdf" && !attachment.originalName.toLowerCase().endsWith(".pdf")) return [attachment];

  const sourcePath = attachmentAbsolutePath(projectDirectory, attachment.relativePath);
  const generatedPaths: string[] = [];
  try {
    const loadingTask = getDocument({ data: await readAttachmentBytes(sourcePath) });
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
        await canvasPngBytes(canvas),
      );
      generatedPaths.push(relativePath);
      images.push({
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
    }
    await loadingTask.destroy();
    await deleteAttachmentFile(sourcePath);
    return images;
  } catch (error) {
    await Promise.all(generatedPaths.map((path) => deleteAttachmentFile(attachmentAbsolutePath(projectDirectory, path))));
    throw error;
  }
}

export interface ProjectPdfMigrationResult {
  project: ProjectData;
  convertedPdfCount: number;
  generatedImageCount: number;
  failures: string[];
}

export async function normalizeProjectAttachmentsToImages(project: ProjectData): Promise<ProjectPdfMigrationResult> {
  if (!project.projectDirectory) {
    return { project, convertedPdfCount: 0, generatedImageCount: 0, failures: [] };
  }

  let convertedPdfCount = 0;
  let generatedImageCount = 0;
  const failures: string[] = [];
  const normalizeList = async (attachments: Attachment[]) => {
    const normalized: Attachment[] = [];
    for (const attachment of attachments) {
      const isPdf = attachment.mimeType === "application/pdf" || attachment.originalName.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        normalized.push(attachment);
        continue;
      }
      try {
        const images = await normalizeAttachmentToImages(project.projectDirectory!, attachment);
        normalized.push(...images);
        convertedPdfCount += 1;
        generatedImageCount += images.length;
      } catch (error) {
        normalized.push(attachment);
        failures.push(`${attachment.originalName}: ${error instanceof Error ? error.message : "PDF 변환 실패"}`);
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
    generatedImageCount,
    failures,
  };
}
