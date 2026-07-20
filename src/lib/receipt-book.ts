import type { Attachment, Expense, OfflineReceiptHolder, ProjectData } from "../types";

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
  offlineHolder?: OfflineReceiptHolder;
  supporting: boolean;
}

export interface ReceiptFlowPlacement {
  item: ReceiptBookItem;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export const DEFAULT_OFFLINE_HOLDER = {
  widthMm: 82,
  heightMm: 62,
} as const;

export function offlineHoldersForExpense(expense: Expense): OfflineReceiptHolder[] {
  return expense.offlineHolders?.length
    ? expense.offlineHolders
    : [{ id: `${expense.id}-offline-1`, ...DEFAULT_OFFLINE_HOLDER }];
}

export function buildReceiptBookItems(project: ProjectData): ReceiptBookItem[] {
  return project.expenses.flatMap<ReceiptBookItem>((expense) => {
    if (expense.receiptMode === "offline-original") {
      const supporting = expense.attachments.filter((attachment) => attachment.kind !== "offline-preview");
      return [
        ...offlineHoldersForExpense(expense).map((offlineHolder) => ({
          id: `${expense.id}-${offlineHolder.id}`,
          expense,
          offlineHolder,
          supporting: false,
        })),
        ...supporting.map((attachment) => ({ id: `${expense.id}-${attachment.id}`, expense, attachment, supporting: true })),
      ];
    }
    const baseAttachment = expense.receiptMode === "online-printable" ? expense.attachments[0] : undefined;
    const supporting = expense.attachments.slice(1);
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
  if (!cropMode) {
    const horizontalRatio = horizontalDelta / widthMm;
    const verticalRatio = verticalDelta / heightMm;
    const requestedRatio = Math.abs(horizontalRatio) > Math.abs(verticalRatio) ? horizontalRatio : verticalRatio;
    const minimumScale = Math.max(32 / widthMm, 20 / heightMm, 0.25);
    const maximumScale = Math.min(RECEIPT_FLOW_WIDTH_MM / widthMm, RECEIPT_FLOW_HEIGHT_MM / heightMm);
    const scale = clamp(1 + requestedRatio, minimumScale, maximumScale);
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
  if (item.offlineHolder) {
    return {
      widthMm: clamp(item.offlineHolder.widthMm, 32, RECEIPT_FLOW_WIDTH_MM),
      heightMm: clamp(item.offlineHolder.heightMm, 20, RECEIPT_FLOW_HEIGHT_MM),
    };
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
  let column: Array<{ item: ReceiptBookItem; widthMm: number; heightMm: number }> = [];
  let columnHeightMm = 0;
  let columnWidthMm = 0;

  const flushColumn = () => {
    if (column.length === 0) return;
    if (page.length > 0 && xMm + columnWidthMm > RECEIPT_FLOW_WIDTH_MM + 0.001) {
      pages.push(page);
      page = [];
      xMm = 0;
    }
    let yMm = 0;
    for (const entry of column) {
      page.push({ ...entry, xMm, yMm });
      yMm += entry.heightMm + RECEIPT_FLOW_GAP_MM;
    }
    xMm += columnWidthMm + RECEIPT_FLOW_GAP_MM;
    column = [];
    columnHeightMm = 0;
    columnWidthMm = 0;
  };

  for (const item of items) {
    const dimensions = dimensionsForItem(item, measuredAspectRatios);
    const nextHeight = columnHeightMm
      + (column.length > 0 ? RECEIPT_FLOW_GAP_MM : 0)
      + dimensions.heightMm;
    if (column.length > 0 && nextHeight > RECEIPT_FLOW_HEIGHT_MM + 0.001) flushColumn();
    column.push({ item, ...dimensions });
    columnHeightMm += (column.length > 1 ? RECEIPT_FLOW_GAP_MM : 0) + dimensions.heightMm;
    columnWidthMm = Math.max(columnWidthMm, dimensions.widthMm);
  }
  flushColumn();
  if (page.length > 0) pages.push(page);
  return pages;
}
