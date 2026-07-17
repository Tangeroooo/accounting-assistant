import type { Attachment, Expense, ProjectData } from "../types";

export const RECEIPT_FLOW_WIDTH_MM = 190;
export const RECEIPT_FLOW_HEIGHT_MM = 262;
export const RECEIPT_FLOW_GAP_MM = 4;
export const DEFAULT_IMAGE_LAYOUT = {
  widthMm: 72,
  aspectRatio: 0.72,
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

function dimensionsForItem(item: ReceiptBookItem, measuredAspectRatios?: Map<string, number>) {
  if (item.expense.receiptMode === "offline-original" && !item.supporting) {
    return { widthMm: 82, heightMm: 62 };
  }
  const layout = { ...DEFAULT_IMAGE_LAYOUT, ...item.attachment?.layout };
  const rawAspectRatio = item.attachment
    ? measuredAspectRatios?.get(item.attachment.id) ?? layout.aspectRatio
    : layout.aspectRatio;
  const safeAspectRatio = clamp(rawAspectRatio || DEFAULT_IMAGE_LAYOUT.aspectRatio, 0.12, 8);
  const normalizedRotation = ((layout.rotation % 360) + 360) % 360;
  const aspectRatio = normalizedRotation === 90 || normalizedRotation === 270
    ? 1 / safeAspectRatio
    : safeAspectRatio;
  let widthMm = clamp(layout.widthMm || DEFAULT_IMAGE_LAYOUT.widthMm, 32, RECEIPT_FLOW_WIDTH_MM);
  let heightMm = widthMm / aspectRatio;
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
