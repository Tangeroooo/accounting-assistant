import { describe, expect, it } from "vitest";

import { createEmptyProject, type Expense } from "../types";
import { buildReceiptBookItems, layoutReceiptBookItems, resizePictureFrame } from "./receipt-book";

const expense = (index: number): Expense => ({
  id: `expense-${index}`,
  createdOrder: index,
  category: "meals",
  date: `2026-07-${String(index).padStart(2, "0")}`,
  content: `식사 ${index}`,
  amount: index * 10_000,
  note: "",
  receiptMode: "offline-original",
  originalConfirmed: true,
  attachments: [],
  itemDetails: "",
  isFuel: false,
  paymentSource: "team",
  settlementTargetAmount: 0,
  settledAmount: 0,
  settlementStatus: "not-applicable",
  receiptNumber: index,
});

describe("영수증철 페이지 구성", () => {
  it("가변 크기 영수증을 금전출납부 순서대로 배치하고 A4 높이를 넘으면 다음 페이지로 보낸다", () => {
    const project = createEmptyProject();
    project.expenses = Array.from({ length: 10 }, (_, index) => expense(index + 1));
    const pages = layoutReceiptBookItems(buildReceiptBookItems(project));
    expect(pages.map((page) => page.map((placement) => placement.item.expense.id))).toEqual([
      ["expense-1", "expense-2", "expense-3", "expense-4", "expense-5", "expense-6", "expense-7", "expense-8"],
      ["expense-9", "expense-10"],
    ]);
  });

  it("앞 그림의 세로 길이를 줄이면 뒤 그림이 위로 이어 붙어 세로 우선으로 재배치된다", () => {
    const project = createEmptyProject();
    project.expenses = Array.from({ length: 3 }, (_, index) => ({
      ...expense(index + 1),
      receiptMode: "online-printable" as const,
      attachments: [{
        id: `attachment-${index + 1}`,
        relativePath: `attachments/${index + 1}.png`,
        originalName: `${index + 1}.png`,
        mimeType: "image/png",
        kind: "online-receipt" as const,
        layout: { widthMm: 70, heightMm: 80, aspectRatio: 1, fit: "cover" as const, scale: 1, offsetX: 0, offsetY: 0, rotation: 0 },
      }],
    }));
    const before = layoutReceiptBookItems(buildReceiptBookItems(project))[0];
    expect(before.map(({ xMm, yMm }) => ({ xMm, yMm }))).toEqual([
      { xMm: 0, yMm: 0 },
      { xMm: 0, yMm: 84 },
      { xMm: 0, yMm: 168 },
    ]);

    project.expenses[0].attachments[0].layout!.heightMm = 40;
    const after = layoutReceiptBookItems(buildReceiptBookItems(project))[0];
    expect(after.map(({ xMm, yMm }) => ({ xMm, yMm }))).toEqual([
      { xMm: 0, yMm: 0 },
      { xMm: 0, yMm: 44 },
      { xMm: 0, yMm: 128 },
    ]);
  });

  it("자르기 프레임의 독립적인 너비와 높이를 자동 배치에 반영한다", () => {
    const project = createEmptyProject();
    project.expenses = [{
      ...expense(1),
      receiptMode: "online-printable",
      attachments: [{
        id: "cropped",
        relativePath: "attachments/cropped.png",
        originalName: "cropped.png",
        mimeType: "image/png",
        kind: "online-receipt",
        layout: { widthMm: 110, heightMm: 42, aspectRatio: 0.5, fit: "cover", scale: 1, offsetX: 0, offsetY: 0, rotation: 0 },
      }],
    }];
    expect(layoutReceiptBookItems(buildReceiptBookItems(project))[0][0]).toMatchObject({ widthMm: 110, heightMm: 42 });
  });

  it("일반 모드의 모서리 핸들은 비율을 유지하고 자르기 핸들은 한쪽 프레임만 바꾼다", () => {
    expect(resizePictureFrame({ widthMm: 80, heightMm: 120, handle: "se", deltaXmm: 20, deltaYmm: 5, cropMode: false })).toEqual({ widthMm: 100, heightMm: 150 });
    expect(resizePictureFrame({ widthMm: 80, heightMm: 120, handle: "e", deltaXmm: 20, deltaYmm: 0, cropMode: false })).toEqual({ widthMm: 100, heightMm: 150 });
    expect(resizePictureFrame({ widthMm: 80, heightMm: 120, handle: "e", deltaXmm: -25, deltaYmm: 0, cropMode: true })).toEqual({ widthMm: 55, heightMm: 120 });
  });

  it("한 지출에 여러 실물 홀더를 만들고 각 홀더 크기로 자동 배치한다", () => {
    const project = createEmptyProject();
    project.expenses = [{
      ...expense(1),
      offlineHolders: [
        { id: "holder-1", widthMm: 50, heightMm: 90 },
        { id: "holder-2", widthMm: 120, heightMm: 45 },
      ],
    }];
    const items = buildReceiptBookItems(project);
    expect(items.map((item) => item.offlineHolder?.id)).toEqual(["holder-1", "holder-2"]);
    expect(layoutReceiptBookItems(items)[0]).toMatchObject([
      { widthMm: 50, heightMm: 90 },
      { widthMm: 120, heightMm: 45 },
    ]);
  });
});
