import type { Attachment, Expense, ProjectData } from "../types";

export const RECEIPTS_PER_PAGE = 6;
export const DEFAULT_IMAGE_LAYOUT = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 } as const;

export interface ReceiptBookItem {
  id: string;
  expense: Expense;
  attachment?: Attachment;
  supporting: boolean;
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

export function paginateReceiptItems(items: ReceiptBookItem[]) {
  return Array.from(
    { length: Math.ceil(items.length / RECEIPTS_PER_PAGE) },
    (_, index) => items.slice(index * RECEIPTS_PER_PAGE, (index + 1) * RECEIPTS_PER_PAGE),
  );
}

export function receiptGridPosition(index: number) {
  return { column: Math.floor(index / 3), row: index % 3 };
}
