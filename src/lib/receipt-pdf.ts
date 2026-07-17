import { jsPDF } from "jspdf";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { Attachment, ProjectData } from "../types";
import { attachmentAbsolutePath, readAttachmentBytes } from "./desktop";
import { buildReceiptBookItems, DEFAULT_IMAGE_LAYOUT, layoutReceiptBookItems } from "./receipt-book";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const DPI = 200;
const PX_PER_MM = DPI / 25.4;

const mm = (value: number) => value * PX_PER_MM;

function createPageCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(mm(PAGE_WIDTH_MM));
  canvas.height = Math.round(mm(PAGE_HEIGHT_MM));
  return canvas;
}

function drawPageHeader(context: CanvasRenderingContext2D, project: ProjectData) {
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, mm(PAGE_WIDTH_MM), mm(PAGE_HEIGHT_MM));
  context.fillStyle = "#111827";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${Math.round(mm(5))}px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  context.fillText(`${project.meta.community || "○○○"} 공동체 - 국내 ${project.meta.teamName || "○○○팀"} - 영수증철`, mm(PAGE_WIDTH_MM / 2), mm(12));
  context.strokeStyle = "#cfd4dc";
  context.lineWidth = Math.max(1, mm(0.2));
  context.beginPath();
  context.moveTo(mm(10), mm(20));
  context.lineTo(mm(200), mm(20));
  context.stroke();
}

async function renderPdfFirstPage(bytes: Uint8Array) {
  const pdfDocument = await getDocument({ data: bytes }).promise;
  const page = await pdfDocument.getPage(1);
  const initial = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2.5, 1800 / initial.width) });
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PDF 증빙을 그릴 수 없습니다.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
}

async function renderImage(bytes: Uint8Array, mimeType: string) {
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("영수증 이미지를 그릴 수 없습니다.");
    context.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderAttachment(project: ProjectData, attachment: Attachment) {
  if (!project.projectDirectory) throw new Error("프로젝트 작업 폴더가 없어 첨부파일을 읽을 수 없습니다.");
  const bytes = await readAttachmentBytes(attachmentAbsolutePath(project.projectDirectory, attachment.relativePath));
  return attachment.mimeType === "application/pdf"
    ? renderPdfFirstPage(bytes)
    : renderImage(bytes, attachment.mimeType);
}

function drawPlacedImage(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  bounds: { x: number; y: number; width: number; height: number },
  attachment: Attachment,
) {
  const layout = { ...DEFAULT_IMAGE_LAYOUT, ...attachment.layout };
  const rotation = layout.rotation * Math.PI / 180;
  const fittedWidth = Math.abs(source.width * Math.cos(rotation)) + Math.abs(source.height * Math.sin(rotation));
  const fittedHeight = Math.abs(source.width * Math.sin(rotation)) + Math.abs(source.height * Math.cos(rotation));
  const horizontalScale = bounds.width / fittedWidth;
  const verticalScale = bounds.height / fittedHeight;
  const baseScale = layout.fit === "cover"
    ? Math.max(horizontalScale, verticalScale)
    : Math.min(horizontalScale, verticalScale);
  const width = source.width * baseScale * layout.scale;
  const height = source.height * baseScale * layout.scale;
  const centerX = bounds.x + bounds.width / 2 + bounds.width * layout.offsetX / 100;
  const centerY = bounds.y + bounds.height / 2 + bounds.height * layout.offsetY / 100;
  context.save();
  context.beginPath();
  context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.clip();
  context.translate(centerX, centerY);
  context.rotate(layout.rotation * Math.PI / 180);
  context.drawImage(source, -width / 2, -height / 2, width, height);
  context.restore();
}

function drawOfflinePlaceholder(context: CanvasRenderingContext2D, bounds: { x: number; y: number; width: number; height: number }) {
  const width = mm(32);
  const height = mm(17);
  context.save();
  context.strokeStyle = "#9ca3af";
  context.lineWidth = Math.max(1, mm(0.2));
  context.setLineDash([mm(1.2), mm(1.2)]);
  context.strokeRect(bounds.x + (bounds.width - width) / 2, bounds.y + (bounds.height - height) / 2, width, height);
  context.restore();
}

export async function createReceiptBookPdf(project: ProjectData) {
  const items = buildReceiptBookItems(project);
  const renderedAttachments = new Map<string, HTMLCanvasElement>();
  const measuredAspectRatios = new Map<string, number>();
  for (const item of items) {
    if (!item.attachment || renderedAttachments.has(item.attachment.id)) continue;
    const rendered = await renderAttachment(project, item.attachment);
    renderedAttachments.set(item.attachment.id, rendered);
    measuredAspectRatios.set(item.attachment.id, rendered.width / rendered.height);
  }
  const pages = layoutReceiptBookItems(items, measuredAspectRatios);
  if (pages.length === 0) throw new Error("PDF로 저장할 영수증이 없습니다.");
  const pageCanvases: HTMLCanvasElement[] = [];

  for (const placements of pages) {
    const canvas = createPageCanvas();
    const context = canvas.getContext("2d");
    if (!context) throw new Error("영수증철 PDF 페이지를 만들 수 없습니다.");
    drawPageHeader(context, project);
    for (const placement of placements) {
      const { item } = placement;
      const bounds = {
        x: mm(10 + placement.xMm),
        y: mm(25 + placement.yMm),
        width: mm(placement.widthMm),
        height: mm(placement.heightMm),
      };
      if (item.expense.receiptMode === "offline-original" && !item.supporting) {
        drawOfflinePlaceholder(context, bounds);
      } else if (item.attachment) {
        const rendered = renderedAttachments.get(item.attachment.id);
        if (rendered) drawPlacedImage(context, rendered, bounds, item.attachment);
      }
    }
    pageCanvases.push(canvas);
  }

  const fuelEvidence = project.categoryEvidence.find((evidence) => evidence.category === "transport" && evidence.kind === "fuel-calculation")?.attachments[0];
  if (fuelEvidence) {
    const canvas = createPageCanvas();
    const context = canvas.getContext("2d");
    if (!context) throw new Error("주유비 증빙 PDF 페이지를 만들 수 없습니다.");
    drawPageHeader(context, project);
    drawPlacedImage(context, await renderAttachment(project, fuelEvidence), { x: mm(12), y: mm(25), width: mm(186), height: mm(260) }, fuelEvidence);
    pageCanvases.push(canvas);
  }

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  pageCanvases.forEach((canvas, index) => {
    if (index > 0) pdf.addPage("a4", "portrait");
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM, undefined, "FAST");
  });
  return new Uint8Array(pdf.output("arraybuffer"));
}
