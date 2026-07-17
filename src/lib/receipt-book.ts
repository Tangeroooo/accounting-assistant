import type { Attachment, Expense, ProjectData } from "../types";

export const RECEIPT_FLOW_WIDTH_MM = 190;
export const RECEIPT_FLOW_HEIGHT_MM = 262;
export const RECEIPT_FLOW_GAP_MM = 4;
export const DEFAULT_IMAGE_LAYOUT = {
  widthMm: 72,
  heightMm: undefined as number | undefined,
  aspectRatio: 0.72,
  fit: "contain" as const,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
} as const;

export interface ReceiptBookItem {
  id: string;
  expense: Expense;
  attachment?: Attachment;
  supporting: boolean;
}

export interface ReceiptFlowPlacement {
  item: ReceiptBookItem;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export function buildReceiptBookItems(project: ProjectData): ReceiptBookItem[] {
  return project.expenses.flatMap((expense) => {
    const baseAttachment = expense.receiptMode === "online-printable" ? expense.attachments[0] : undefined;
    const supporting = expense.receiptMode === "online-printable"
      ? expense.attachments.slice(1)
      : expense.attachments.filter((attachment) => attachment.kind !== "offline-preview");
    return [
      { id: `${expense.id}-receipt`, expense, attachment: baseAttachment, supporting: false },
      ...supporting.map((attachment) => ({ id: `${expense.id}-${attachment.id}`, expense, attachment, supporting: true })),
    ];
  });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resizePictureFrame({ widthMm, heightMm, handle, deltaXmm, deltaYmm, cropMode }: {
  widthMm: number;
  heightMm: number;
  handle: string;
  deltaXmm: number;
  deltaYmm: number;
  cropMode: boolean;
}) {
  const horizontalDelta = handle.includes("e") ? deltaXmm : handle.includes("w") ? -deltaXmm : 0;
  const verticalDelta = handle.includes("s") ? deltaYmm : handle.includes("n") ? -deltaYmm : 0;
  let nextWidth = widthMm;
  let nextHeight = heightMm;
  if (!cropMode && horizontalDelta !== 0 && verticalDelta !== 0) {
    const horizontalRatio = horizontalDelta / widthMm;
    const verticalRatio = verticalDelta / heightMm;
    const scale = Math.max(0.25, 1 + (Math.abs(horizontalRatio) > Math.abs(verticalRatio) ? horizontalRatio : verticalRatio));
    nextWidth = widthMm * scale;
    nextHeight = heightMm * scale;
  } else {
    if (horizontalDelta !== 0) nextWidth += horizontalDelta;
    if (verticalDelta !== 0) nextHeight += verticalDelta;
  }
  return {
    widthMm: clamp(nextWidth, 32, RECEIPT_FLOW_WIDTH_MM),
    heightMm: clamp(nextHeight, 20, RECEIPT_FLOW_HEIGHT_MM),
  };
}

function dimensionsForItem(item: ReceiptBookItem, measuredAspectRatios?: Map<string, number>) {
  if (item.expense.receiptMode === "offline-original" && !item.supporting) {
    return { widthMm: 82, heightMm: 62 };
  }
  const layout = { ...DEFAULT_IMAGE_LAYOUT, ...item.attachment?.layout };
  const rawAspectRatio = item.attachment
    ? measuredAspectRatios?.get(item.attachment.id) ?? layout.aspectRatio
    : layout.aspectRatio;
  const safeAspectRatio = clamp(rawAspectRatio || DEFAULT_IMAGE_LAYOUT.aspectRatio, 0.12, 8);
  const rotation = ((layout.rotation % 360) + 360) % 360 * Math.PI / 180;
  const cosine = Math.abs(Math.cos(rotation));
  const sine = Math.abs(Math.sin(rotation));
  const aspectRatio = (safeAspectRatio * cosine + sine) / (safeAspectRatio * sine + cosine);
  let widthMm = clamp(layout.widthMm || DEFAULT_IMAGE_LAYOUT.widthMm, 32, RECEIPT_FLOW_WIDTH_MM);
  let heightMm = layout.heightMm && Number.isFinite(layout.heightMm)
    ? clamp(layout.heightMm, 20, RECEIPT_FLOW_HEIGHT_MM)
    : widthMm / aspectRatio;
  if (heightMm > RECEIPT_FLOW_HEIGHT_MM) {
    const scale = RECEIPT_FLOW_HEIGHT_MM / heightMm;
    widthMm *= scale;
    heightMm = RECEIPT_FLOW_HEIGHT_MM;
  }
  return { widthMm, heightMm };
}

export function layoutReceiptBookItems(
  items: ReceiptBookItem[],
  measuredAspectRatios?: Map<string, number>,
): ReceiptFlowPlacement[][] {
  const pages: ReceiptFlowPlacement[][] = [];
  let page: ReceiptFlowPlacement[] = [];
  let xMm = 0;
  let yMm = 0;
  let rowHeightMm = 0;

  for (const item of items) {
    const { widthMm, heightMm } = dimensionsForItem(item, measuredAspectRatios);
    if (xMm > 0 && xMm + widthMm > RECEIPT_FLOW_WIDTH_MM + 0.001) {
      xMm = 0;
      yMm += rowHeightMm + RECEIPT_FLOW_GAP_MM;
      rowHeightMm = 0;
    }
    if (page.length > 0 && yMm + heightMm > RECEIPT_FLOW_HEIGHT_MM + 0.001) {
      pages.push(page);
      page = [];
      xMm = 0;
      yMm = 0;
      rowHeightMm = 0;
    }
    page.push({ item, xMm, yMm, widthMm, heightMm });
    xMm += widthMm + RECEIPT_FLOW_GAP_MM;
    rowHeightMm = Math.max(rowHeightMm, heightMm);
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
