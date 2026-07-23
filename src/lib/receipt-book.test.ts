import { describe, expect, it } from "vitest";

import { createEmptyProject, type Expense } from "../types";
import { buildReceiptBookItems, centeredColumnResizeOffset, cropPictureFrame, exportedOfflinePlaceholderLabel, layoutReceiptBookItems, offlineHolderDimensionsLabel, offlinePlaceholderLabel, pictureLayoutGeometry, receiptAmountLabel, receiptWatermarkDisplayLabel, receiptWatermarkLabel, resizePictureFrame, watermarkFontSizePx } from "./receipt-book";

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
      { xMm: 60, yMm: 0 },
      { xMm: 60, yMm: 84 },
      { xMm: 60, yMm: 168 },
    ]);

    project.expenses[0].attachments[0].layout!.heightMm = 40;
    const after = layoutReceiptBookItems(buildReceiptBookItems(project))[0];
    expect(after.map(({ xMm, yMm }) => ({ xMm, yMm }))).toEqual([
      { xMm: 60, yMm: 0 },
      { xMm: 60, yMm: 44 },
      { xMm: 60, yMm: 128 },
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

  it("같은 영수증의 이미지에 항목명-영수증번호-일련번호 워터마크를 부여한다", () => {
    const project = createEmptyProject();
    project.expenses = [{
      ...expense(1),
      receiptMode: "online-printable",
      attachments: [
        { id: "image-1", relativePath: "attachments/1.png", originalName: "1.png", mimeType: "image/png", kind: "online-receipt" },
        { id: "image-2", relativePath: "attachments/2.png", originalName: "2.png", mimeType: "image/png", kind: "transaction-statement" },
      ],
    }];

    expect(buildReceiptBookItems(project).map(receiptWatermarkLabel)).toEqual([
      "식대간식비-1-1",
      "식대간식비-1-2",
    ]);
    expect(buildReceiptBookItems(project).map(receiptWatermarkDisplayLabel)).toEqual([
      "식대간식비-1-1 · 10,000원",
      "식대간식비-1-2",
    ]);
  });

  it("작은 그림 영역에서는 전체 워터마크 라벨이 들어가도록 글자 크기를 줄인다", () => {
    expect(watermarkFontSizePx("교통비-1-1", 120, 90)).toBe(20);
    expect(watermarkFontSizePx("팀별사역비-공통증빙-12", 32, 20)).toBeGreaterThanOrEqual(5);
    expect(watermarkFontSizePx("팀별사역비-공통증빙-12", 32, 20)).toBeLessThan(10);
  });

  it("실물 영수증 홀더 크기를 가로·세로 cm 단위로 표시한다", () => {
    expect(offlineHolderDimensionsLabel({ id: "holder", widthMm: 82, heightMm: 62 })).toBe("가로 8.2cm × 세로 6.2cm");
    expect(offlineHolderDimensionsLabel({ id: "holder", widthMm: 100, heightMm: 50 })).toBe("가로 10cm × 세로 5cm");
  });

  it("일반 모드의 모서리 핸들은 비율을 유지하고 자르기 핸들은 한쪽 프레임만 바꾼다", () => {
    expect(resizePictureFrame({ widthMm: 80, heightMm: 120, handle: "se", deltaXmm: 20, deltaYmm: 5, cropMode: false })).toEqual({ widthMm: 100, heightMm: 150 });
    expect(resizePictureFrame({ widthMm: 80, heightMm: 120, handle: "e", deltaXmm: 20, deltaYmm: 0, cropMode: false })).toEqual({ widthMm: 100, heightMm: 150 });
    expect(resizePictureFrame({ widthMm: 80, heightMm: 120, handle: "e", deltaXmm: -25, deltaYmm: 0, cropMode: true })).toEqual({ widthMm: 55, heightMm: 120 });
  });

  it("자르기 프레임을 줄여도 원본 그림의 크기와 절대 중심 위치를 유지한다", () => {
    const layout = { widthMm: 100, heightMm: 70, aspectRatio: 1.5, fit: "cover" as const, scale: 1.2, offsetX: 12, offsetY: -8, rotation: 0 };
    const before = pictureLayoutGeometry(100, 70, layout);
    const cropped = cropPictureFrame({ widthMm: 100, heightMm: 70, handle: "e", deltaXmm: -20, deltaYmm: 0, layout });
    const after = pictureLayoutGeometry(cropped.widthMm, cropped.heightMm, { ...layout, ...cropped });

    expect(cropped).toMatchObject({ widthMm: 80, heightMm: 70 });
    expect(after.contentWidthMm).toBeCloseTo(before.contentWidthMm, 6);
    expect(after.contentHeightMm).toBeCloseTo(before.contentHeightMm, 6);
    expect(cropped.frameOffsetXMm + cropped.widthMm / 2 + cropped.offsetX * cropped.widthMm / 100)
      .toBeCloseTo(100 / 2 + layout.offsetX * 100 / 100, 6);
    expect(cropped.frameOffsetYMm + cropped.heightMm / 2 + cropped.offsetY * cropped.heightMm / 100)
      .toBeCloseTo(70 / 2 + layout.offsetY * 70 / 100, 6);
  });

  it("자르기 핸들의 반대편 프레임 모서리를 고정한다", () => {
    const layout = { widthMm: 100, heightMm: 70, aspectRatio: 1.5, fit: "cover" as const, scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };
    const east = cropPictureFrame({ widthMm: 100, heightMm: 70, handle: "e", deltaXmm: -20, deltaYmm: 0, layout });
    const west = cropPictureFrame({ widthMm: 100, heightMm: 70, handle: "w", deltaXmm: 20, deltaYmm: 0, layout });
    const south = cropPictureFrame({ widthMm: 100, heightMm: 70, handle: "s", deltaXmm: 0, deltaYmm: -15, layout });
    const north = cropPictureFrame({ widthMm: 100, heightMm: 70, handle: "n", deltaXmm: 0, deltaYmm: 15, layout });

    expect(east.frameOffsetXMm).toBe(0);
    expect(east.frameOffsetXMm + east.widthMm).toBe(80);
    expect(west.frameOffsetXMm).toBe(20);
    expect(west.frameOffsetXMm + west.widthMm).toBe(100);
    expect(south.frameOffsetYMm).toBe(0);
    expect(south.frameOffsetYMm + south.heightMm).toBe(55);
    expect(north.frameOffsetYMm).toBe(15);
    expect(north.frameOffsetYMm + north.heightMm).toBe(70);
  });

  it("가운데 정렬된 한 열에서도 자르기 반대편 모서리가 움직이지 않는다", () => {
    const project = createEmptyProject();
    const baseLayout = { widthMm: 100, heightMm: 70, aspectRatio: 1.5, fit: "cover" as const, scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };
    project.expenses = [{
      ...expense(1),
      receiptMode: "online-printable",
      attachments: [{ id: "center-crop", relativePath: "attachments/crop.png", originalName: "crop.png", mimeType: "image/png", kind: "online-receipt", layout: baseLayout }],
    }];
    const before = layoutReceiptBookItems(buildReceiptBookItems(project))[0][0];

    const east = cropPictureFrame({ widthMm: 100, heightMm: 70, handle: "e", deltaXmm: -20, deltaYmm: 0, layout: baseLayout });
    east.frameOffsetXMm += centeredColumnResizeOffset(100, east.widthMm);
    project.expenses[0].attachments[0].layout = { ...baseLayout, ...east };
    const afterEast = layoutReceiptBookItems(buildReceiptBookItems(project))[0][0];
    expect(afterEast.xMm).toBeCloseTo(before.xMm, 6);

    const west = cropPictureFrame({ widthMm: 100, heightMm: 70, handle: "w", deltaXmm: 20, deltaYmm: 0, layout: baseLayout });
    west.frameOffsetXMm += centeredColumnResizeOffset(100, west.widthMm);
    project.expenses[0].attachments[0].layout = { ...baseLayout, ...west };
    const afterWest = layoutReceiptBookItems(buildReceiptBookItems(project))[0][0];
    expect(afterWest.xMm + afterWest.widthMm).toBeCloseTo(before.xMm + before.widthMm, 6);

    project.expenses[0].attachments[0].layout = { ...baseLayout, ...west, frameOffsetXMm: 0, frameOffsetYMm: 0 };
    const completed = layoutReceiptBookItems(buildReceiptBookItems(project))[0][0];
    expect(completed.xMm).toBeCloseTo((190 - completed.widthMm) / 2, 6);
  });

  it("한 페이지만 한 열로 채워지면 각 항목을 최종 너비로 가로 중앙에 둔다", () => {
    const project = createEmptyProject();
    project.expenses = [
      { ...expense(1), offlineHolders: [{ id: "narrow", widthMm: 80, heightMm: 90 }] },
      { ...expense(2), offlineHolders: [{ id: "wide", widthMm: 120, heightMm: 90 }] },
    ];

    const page = layoutReceiptBookItems(buildReceiptBookItems(project))[0];
    expect(page).toMatchObject([
      { xMm: 55, pageColumnCount: 1, columnWidthMm: 120 },
      { xMm: 35, pageColumnCount: 1, columnWidthMm: 120 },
    ]);
  });

  it("여러 열도 열 묶음 전체와 각 열의 개별 항목을 최종 너비 기준으로 가운데 둔다", () => {
    const project = createEmptyProject();
    project.expenses = [
      { ...expense(1), offlineHolders: [{ id: "first-1", widthMm: 60, heightMm: 80 }] },
      { ...expense(2), offlineHolders: [{ id: "first-2", widthMm: 60, heightMm: 80 }] },
      { ...expense(3), offlineHolders: [{ id: "first-3", widthMm: 60, heightMm: 80 }] },
      { ...expense(4), offlineHolders: [{ id: "second-wide", widthMm: 100, heightMm: 80 }] },
      { ...expense(5), offlineHolders: [{ id: "second-narrow", widthMm: 70, heightMm: 80 }] },
    ];

    const page = layoutReceiptBookItems(buildReceiptBookItems(project))[0];
    expect(page.map(({ xMm, widthMm }) => ({ xMm, widthMm }))).toEqual([
      { xMm: 13, widthMm: 60 },
      { xMm: 13, widthMm: 60 },
      { xMm: 13, widthMm: 60 },
      { xMm: 77, widthMm: 100 },
      { xMm: 92, widthMm: 70 },
    ]);
    expect(Math.min(...page.map((placement) => placement.xMm))).toBe(13);
    expect(Math.max(...page.map((placement) => placement.xMm + placement.widthMm))).toBe(177);
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
    expect(items.map(offlinePlaceholderLabel)).toEqual([
      "영수증 3-1 · 1/2",
      "영수증 3-1 · 2/2",
    ]);
    expect(items.map(exportedOfflinePlaceholderLabel)).toEqual([
      "식대간식비-1-1",
      "식대간식비-1-2",
    ]);
    expect(items.map(receiptAmountLabel)).toEqual(["10,000원", undefined]);
  });

  it("항목이 바뀌면 남은 공간과 관계없이 새 페이지에서 시작한다", () => {
    const project = createEmptyProject();
    project.expenses = [
      { ...expense(1), category: "transport", receiptNumber: 1 },
      { ...expense(2), category: "transport", receiptNumber: 2 },
      { ...expense(3), category: "lodging", receiptNumber: 1 },
      { ...expense(4), category: "lodging", receiptNumber: 2 },
      { ...expense(5), category: "meals", receiptNumber: 1 },
    ];

    const pages = layoutReceiptBookItems(buildReceiptBookItems(project));
    expect(pages).toHaveLength(3);
    expect(pages.map((page) => [...new Set(page.map(({ item }) => item.expense.category))])).toEqual([
      ["transport"],
      ["lodging"],
      ["meals"],
    ]);
  });

  it("공통 주유비 산정 증빙의 온라인 파일과 오프라인 홀더를 영수증 뒤에 함께 배치한다", () => {
    const project = createEmptyProject();
    project.expenses = [{ ...expense(1), category: "transport", isFuel: true }];
    project.categoryEvidence = [{
      id: "fuel-evidence",
      category: "transport",
      kind: "fuel-calculation",
      title: "주유비 산정 증빙",
      attachments: [{ id: "fuel-image", relativePath: "attachments/fuel.png", originalName: "fuel.png", mimeType: "image/png", kind: "other" }],
      offlineHolders: [{ id: "fuel-offline", widthMm: 90, heightMm: 70 }],
    }];
    const items = buildReceiptBookItems(project);
    expect(items.slice(0, 2).map((item) => ({ evidenceId: item.evidenceId, attachment: item.attachment?.id, holder: item.offlineHolder?.id }))).toEqual([
      { evidenceId: "fuel-evidence", attachment: "fuel-image", holder: undefined },
      { evidenceId: "fuel-evidence", attachment: undefined, holder: "fuel-offline" },
    ]);
    expect(items.slice(0, 2).map(receiptWatermarkLabel)).toEqual([
      "교통비-공통증빙-1",
      "교통비-공통증빙-2",
    ]);
    expect(items.slice(1, 2).map(exportedOfflinePlaceholderLabel)).toEqual([
      "교통비-공통증빙-2",
    ]);
    expect(items.slice(0, 2).map(receiptAmountLabel)).toEqual([undefined, undefined]);
    expect(layoutReceiptBookItems(items)[0][0]).toMatchObject({
      widthMm: expect.any(Number),
      item: { evidenceId: "fuel-evidence", attachment: { id: "fuel-image" } },
    });
    expect(layoutReceiptBookItems(items)[0][1]).toMatchObject({ widthMm: 90, heightMm: 70 });
  });

  it("공통 주유비 산정 증빙을 앞선 일반 교통비가 아니라 첫 주유비 바로 앞에 배치한다", () => {
    const project = createEmptyProject();
    project.expenses = [
      { ...expense(1), category: "transport", date: "2026-07-01", content: "버스", isFuel: false },
      {
        ...expense(2),
        category: "transport",
        date: "2026-07-02",
        content: "주유",
        isFuel: true,
        offlineHolders: [
          { id: "fuel-receipt-1", widthMm: 80, heightMm: 60 },
          { id: "fuel-receipt-2", widthMm: 80, heightMm: 60 },
        ],
      },
      { ...expense(3), category: "transport", date: "2026-07-03", content: "택시", isFuel: false },
    ];
    project.categoryEvidence = [{
      id: "fuel-evidence",
      category: "transport",
      kind: "fuel-calculation",
      title: "주유비 산정 증빙",
      attachments: [
        { id: "fuel-evidence-1", relativePath: "attachments/fuel-1.png", originalName: "fuel-1.png", mimeType: "image/png", kind: "other" },
        { id: "fuel-evidence-2", relativePath: "attachments/fuel-2.png", originalName: "fuel-2.png", mimeType: "image/png", kind: "other" },
      ],
      offlineHolders: [
        { id: "fuel-evidence-offline-1", widthMm: 90, heightMm: 70 },
        { id: "fuel-evidence-offline-2", widthMm: 90, heightMm: 70 },
      ],
    }];

    const items = buildReceiptBookItems(project);
    expect(items.map((item) => item.evidenceId ? `evidence:${item.receiptSequence}` : `${item.expense.content}:${item.receiptSequence}`)).toEqual([
      "버스:1",
      "evidence:1",
      "evidence:2",
      "evidence:3",
      "evidence:4",
      "주유:1",
      "주유:2",
      "택시:1",
    ]);
    expect(layoutReceiptBookItems(items).flat().map(({ item }) => item.evidenceId ? "evidence" : item.expense.content)).toEqual([
      "버스",
      "evidence",
      "evidence",
      "evidence",
      "evidence",
      "주유",
      "주유",
      "택시",
    ]);
  });
});
