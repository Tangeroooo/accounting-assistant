import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { Attachment } from "../types";
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
  if (attachment.mimeType !== "application/pdf") return [attachment];

  const sourcePath = attachmentAbsolutePath(projectDirectory, attachment.relativePath);
  const generatedPaths: string[] = [];
  try {
    const document = await getDocument({ data: await readAttachmentBytes(sourcePath) }).promise;
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
    await deleteAttachmentFile(sourcePath);
    return images;
  } catch (error) {
    await Promise.all(generatedPaths.map((path) => deleteAttachmentFile(attachmentAbsolutePath(projectDirectory, path))));
    throw error;
  }
}
