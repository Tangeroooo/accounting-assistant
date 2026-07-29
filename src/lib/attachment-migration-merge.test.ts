import { describe, expect, it } from "vitest";

import { createEmptyProject, type Attachment, type Expense } from "../types";
import { mergeAttachmentMigrationResult } from "./attachment-migration-merge";

function attachment(id: string, values: Partial<Attachment> = {}): Attachment {
  return {
    id,
    relativePath: `attachments/${id}.jpg`,
    originalName: `${id}.jpg`,
    mimeType: "image/jpeg",
    kind: "online-receipt",
    ...values,
  };
}

function expense(attachments: Attachment[]): Expense {
  return {
    id: "expense",
    createdOrder: 1,
    category: "meals",
    date: "2026-07-20",
    content: "점심 식사",
    amount: 10_000,
    note: "",
    receiptMode: "online-printable",
    originalConfirmed: false,
    attachments,
    itemDetails: "",
    isFuel: false,
    paymentSource: "team",
    settlementTargetAmount: 0,
    settledAmount: 0,
    settlementStatus: "not-applicable",
  };
}

describe("백그라운드 첨부 이미지 준비 결과 병합", () => {
  it("변환 중 추가된 영수증과 최신 지출 내용을 보존한다", () => {
    const source = createEmptyProject();
    source.expenses = [expense([attachment("old")])];
    const normalized = {
      ...source,
      expenses: [expense([attachment("old", {
        previewRelativePath: "attachments/old-preview.jpg",
        previewMimeType: "image/jpeg",
        previewPrepared: true,
      })])],
    };
    const added = attachment("new-heif", {
      relativePath: "attachments/new.HEIC",
      originalName: "new.HEIC",
      mimeType: "image/heic",
      renderRelativePath: "attachments/new-render.jpg",
      renderMimeType: "image/jpeg",
      previewRelativePath: "attachments/new-preview.jpg",
      previewMimeType: "image/jpeg",
      previewPrepared: true,
    });
    const current = {
      ...source,
      expenses: [{ ...source.expenses[0], content: "수정한 점심 식사", attachments: [...source.expenses[0].attachments, added] }],
    };

    const merged = mergeAttachmentMigrationResult(source, normalized, current);

    expect(merged.expenses[0].content).toBe("수정한 점심 식사");
    expect(merged.expenses[0].attachments.map((item) => item.id)).toEqual(["old", "new-heif"]);
    expect(merged.expenses[0].attachments[0].previewPrepared).toBe(true);
    expect(merged.expenses[0].attachments[1]).toEqual(added);
  });

  it("변환 중 새로 만든 지출을 제거하지 않는다", () => {
    const source = createEmptyProject();
    source.expenses = [expense([attachment("old")])];
    const normalized = {
      ...source,
      expenses: [expense([attachment("old", { previewPrepared: true })])],
    };
    const current = {
      ...source,
      expenses: [...source.expenses, { ...expense([attachment("brand-new")]), id: "new-expense" }],
    };

    const merged = mergeAttachmentMigrationResult(source, normalized, current);

    expect(merged.expenses.map((item) => item.id)).toEqual(["expense", "new-expense"]);
  });
});
