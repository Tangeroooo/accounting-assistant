import { getCategory, type Attachment, type Expense, type OfflineReceiptHolder, type ProjectData } from "../types";

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
  frameOffsetXMm: 0,
  frameOffsetYMm: 0,
  rotation: 0,
} as const;

export interface ReceiptBookItem {
  id: string;
  expense: Expense;
  attachment?: Attachment;
  offlineHolder?: OfflineReceiptHolder;
  evidenceId?: string;
  supporting: boolean;
  receiptSequence: number;
}

export interface ReceiptFlowPlacement {
  item: ReceiptBookItem;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  pageColumnCount?: number;
  columnWidthMm?: number;
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
  const expenseItems = project.expenses.flatMap<ReceiptBookItem>((expense) => {
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
      ].map((item, index) => ({ ...item, receiptSequence: index + 1 }));
    }
    const baseAttachment = expense.receiptMode === "online-printable" ? expense.attachments[0] : undefined;
    const supporting = expense.attachments.slice(1);
    return [
      { id: `${expense.id}-receipt`, expense, attachment: baseAttachment, supporting: false },
      ...supporting.map((attachment) => ({ id: `${expense.id}-${attachment.id}`, expense, attachment, supporting: true })),
    ].map((item, index) => ({ ...item, receiptSequence: index + 1 }));
  });
  const hasFuelExpense = project.expenses.some((expense) => expense.category === "transport" && expense.isFuel);
  const fuelEvidence = hasFuelExpense
    ? project.categoryEvidence.find((evidence) => evidence.category === "transport" && evidence.kind === "fuel-calculation")
    : undefined;
  if (!fuelEvidence) return expenseItems;
  const evidenceExpense: Expense = {
    id: `evidence-${fuelEvidence.id}`,
    createdOrder: Number.MAX_SAFE_INTEGER,
    category: "transport",
    date: "",
    content: fuelEvidence.title || "주유비 산정 증빙",
    amount: 0,
    note: "",
    receiptMode: "online-printable",
    originalConfirmed: false,
    attachments: fuelEvidence.attachments,
    offlineHolders: fuelEvidence.offlineHolders ?? [],
    itemDetails: "",
    isFuel: false,
    paymentSource: "team",
    settlementTargetAmount: 0,
    settledAmount: 0,
    settlementStatus: "not-applicable",
  };
  const evidenceItems: ReceiptBookItem[] = [
    ...fuelEvidence.attachments.map((attachment) => ({
      id: `${fuelEvidence.id}-${attachment.id}`,
      expense: evidenceExpense,
      attachment,
      evidenceId: fuelEvidence.id,
      supporting: false,
    })),
    ...(fuelEvidence.offlineHolders ?? []).map((offlineHolder) => ({
      id: `${fuelEvidence.id}-${offlineHolder.id}`,
      expense: evidenceExpense,
      offlineHolder,
      evidenceId: fuelEvidence.id,
      supporting: false,
    })),
  ].map((item, index) => ({ ...item, receiptSequence: index + 1 }));
  const lastTransportItemIndex = expenseItems.reduce(
    (lastIndex, item, index) => item.expense.category === "transport" ? index : lastIndex,
    -1,
  );
  return [
    ...expenseItems.slice(0, lastTransportItemIndex + 1),
    ...evidenceItems,
    ...expenseItems.slice(lastTransportItemIndex + 1),
  ];
}

export function receiptWatermarkLabel(item: ReceiptBookItem) {
  const categoryName = getCategory(item.expense.category).label;
  const receiptNumber = item.evidenceId ? "공통증빙" : item.expense.receiptNumber ?? "?";
  return `${categoryName}-${receiptNumber}-${item.receiptSequence}`;
}

export function offlinePlaceholderLabel(item: ReceiptBookItem) {
  if (item.evidenceId) {
    const holders = item.expense.offlineHolders ?? [];
    const index = item.offlineHolder
      ? holders.findIndex((holder) => holder.id === item.offlineHolder?.id)
      : -1;
    return holders.length > 1 && index >= 0
      ? `주유비 산정 증빙 · ${index + 1}/${holders.length}`
      : "주유비 산정 증빙";
  }

  const category = getCategory(item.expense.category);
  const receiptNumber = item.expense.receiptNumber ?? "?";
  const holders = offlineHoldersForExpense(item.expense);
  const index = item.offlineHolder
    ? holders.findIndex((holder) => holder.id === item.offlineHolder?.id)
    : -1;
  const receiptCode = `영수증 ${category.number}-${receiptNumber}`;
  return holders.length > 1 && index >= 0
    ? `${receiptCode} · ${index + 1}/${holders.length}`
    : receiptCode;
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

export interface PictureLayoutGeometry {
  contentWidthMm: number;
  contentHeightMm: number;
  boundsWidthMm: number;
  boundsHeightMm: number;
  baseScale: number;
}

type PictureLayout = Pick<NonNullable<Attachment["layout"]>, "aspectRatio" | "fit" | "scale" | "rotation">;

/**
 * 브라우저 미리보기와 PDF가 동일한 방식으로 그림을 프레임에 맞추도록
 * 회전 전 그림 크기와 회전 후 외곽 크기를 계산한다.
 */
export function pictureLayoutGeometry(
  frameWidthMm: number,
  frameHeightMm: number,
  layout: PictureLayout,
): PictureLayoutGeometry {
  const aspectRatio = clamp(layout.aspectRatio || DEFAULT_IMAGE_LAYOUT.aspectRatio, 0.12, 8);
  const rotation = ((layout.rotation % 360) + 360) % 360 * Math.PI / 180;
  const cosine = Math.abs(Math.cos(rotation));
  const sine = Math.abs(Math.sin(rotation));
  const sourceWidth = aspectRatio;
  const sourceHeight = 1;
  const rotatedWidth = sourceWidth * cosine + sourceHeight * sine;
  const rotatedHeight = sourceWidth * sine + sourceHeight * cosine;
  const horizontalScale = frameWidthMm / rotatedWidth;
  const verticalScale = frameHeightMm / rotatedHeight;
  const baseScale = layout.fit === "cover"
    ? Math.max(horizontalScale, verticalScale)
    : Math.min(horizontalScale, verticalScale);
  const contentScale = baseScale * layout.scale;
  return {
    contentWidthMm: sourceWidth * contentScale,
    contentHeightMm: sourceHeight * contentScale,
    boundsWidthMm: rotatedWidth * contentScale,
    boundsHeightMm: rotatedHeight * contentScale,
    baseScale,
  };
}

/**
 * Word/Excel의 자르기처럼 프레임만 바꾸고 원본 그림의 실제 크기는 유지한다.
 * offset은 프레임 중심 기준 백분율이므로 새 프레임 크기에 맞게 환산한다.
 */
export function cropPictureFrame({ widthMm, heightMm, handle, deltaXmm, deltaYmm, layout }: {
  widthMm: number;
  heightMm: number;
  handle: string;
  deltaXmm: number;
  deltaYmm: number;
  layout: NonNullable<Attachment["layout"]>;
}) {
  const nextFrame = resizePictureFrame({
    widthMm,
    heightMm,
    handle,
    deltaXmm,
    deltaYmm,
    cropMode: true,
  });
  const currentGeometry = pictureLayoutGeometry(widthMm, heightMm, layout);
  const nextBaseGeometry = pictureLayoutGeometry(nextFrame.widthMm, nextFrame.heightMm, { ...layout, scale: 1 });
  const nextScale = clamp(
    layout.scale * currentGeometry.baseScale / nextBaseGeometry.baseScale,
    0.1,
    12,
  );
  const frameShiftX = handle.includes("w") ? widthMm - nextFrame.widthMm : 0;
  const frameShiftY = handle.includes("n") ? heightMm - nextFrame.heightMm : 0;
  const oldImageCenterX = widthMm / 2 + widthMm * layout.offsetX / 100;
  const oldImageCenterY = heightMm / 2 + heightMm * layout.offsetY / 100;
  return {
    ...nextFrame,
    scale: nextScale,
    offsetX: clamp((oldImageCenterX - frameShiftX - nextFrame.widthMm / 2) / nextFrame.widthMm * 100, -300, 300),
    offsetY: clamp((oldImageCenterY - frameShiftY - nextFrame.heightMm / 2) / nextFrame.heightMm * 100, -300, 300),
    frameOffsetXMm: (layout.frameOffsetXMm ?? 0) + frameShiftX,
    frameOffsetYMm: (layout.frameOffsetYMm ?? 0) + frameShiftY,
  };
}

export function centeredColumnResizeOffset(
  currentColumnWidthMm: number,
  nextFrameWidthMm: number,
  otherColumnMaxWidthMm: number,
) {
  const nextColumnWidthMm = Math.max(otherColumnMaxWidthMm, nextFrameWidthMm);
  return (nextColumnWidthMm - currentColumnWidthMm) / 2;
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
  let currentCategory = items[0]?.expense.category;

  const commitPage = () => {
    if (page.length === 0) return;
    const columnPositions = [...new Set(page.map((placement) => placement.xMm))];
    const pageColumnCount = columnPositions.length;
    const columnWidths = new Map(columnPositions.map((columnX) => [
      columnX,
      Math.max(...page.filter((placement) => placement.xMm === columnX).map((placement) => placement.widthMm)),
    ]));
    const centeredColumnOffset = pageColumnCount === 1
      ? (RECEIPT_FLOW_WIDTH_MM - (columnWidths.get(columnPositions[0]) ?? 0)) / 2
      : 0;
    pages.push(page.map((placement) => {
      const layout = placement.item.attachment
        ? { ...DEFAULT_IMAGE_LAYOUT, ...placement.item.attachment.layout }
        : undefined;
      return {
        ...placement,
        xMm: placement.xMm + centeredColumnOffset + (layout?.frameOffsetXMm ?? 0),
        yMm: placement.yMm + (layout?.frameOffsetYMm ?? 0),
        pageColumnCount,
        columnWidthMm: columnWidths.get(placement.xMm) ?? placement.widthMm,
      };
    }));
    page = [];
    xMm = 0;
  };

  const flushColumn = () => {
    if (column.length === 0) return;
    if (page.length > 0 && xMm + columnWidthMm > RECEIPT_FLOW_WIDTH_MM + 0.001) {
      commitPage();
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
    if (currentCategory && item.expense.category !== currentCategory) {
      flushColumn();
      commitPage();
      currentCategory = item.expense.category;
    }
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
  commitPage();
  return pages;
}
