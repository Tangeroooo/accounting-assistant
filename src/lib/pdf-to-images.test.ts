// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyProject, type Attachment, type Expense } from "../types";

const mocks = vi.hoisted(() => ({
  deleteAttachmentFile: vi.fn(),
  destroyDocument: vi.fn(),
  readAttachmentBytes: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  writeAttachmentBytes: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    destroy: mocks.destroyDocument,
    promise: Promise.resolve({
      numPages: 2,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 900 * scale }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
  }),
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf-worker.js" }));
vi.mock("./desktop", () => ({
  attachmentAbsolutePath: (directory: string, relativePath: string) => `${directory}/${relativePath}`,
  ...mocks,
}));

import { normalizeAttachmentToImages, normalizeProjectAttachmentsToImages } from "./pdf-to-images";

const pdfAttachment: Attachment = {
  id: "pdf",
  relativePath: "attachments/source.pdf",
  originalName: "긴 영수증.pdf",
  mimeType: "application/pdf",
  kind: "online-receipt",
};

describe("PDF 첨부 이미지 변환", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Blob);
    });
  });

  it("모든 페이지를 PNG 첨부로 만들고 원본 PDF는 제거한다", async () => {
    const images = await normalizeAttachmentToImages("/project", pdfAttachment);

    expect(images).toHaveLength(2);
    expect(images.map((image) => image.mimeType)).toEqual(["image/png", "image/png"]);
    expect(images.map((image) => image.originalName)).toEqual(["긴 영수증-1페이지.png", "긴 영수증-2페이지.png"]);
    expect(images.every((image) => image.relativePath.endsWith(".png"))).toBe(true);
    expect(mocks.writeAttachmentBytes).toHaveBeenCalledTimes(2);
    expect(mocks.destroyDocument).toHaveBeenCalledOnce();
    expect(mocks.deleteAttachmentFile).toHaveBeenCalledWith("/project/attachments/source.pdf");
  });

  it("이미지 첨부는 변환하지 않고 그대로 돌려준다", async () => {
    const image = { ...pdfAttachment, mimeType: "image/png", originalName: "긴 영수증.png", relativePath: "attachments/source.png" };
    expect(await normalizeAttachmentToImages("/project", image)).toEqual([image]);
    expect(mocks.writeAttachmentBytes).not.toHaveBeenCalled();
  });

  it("기존 프로젝트의 지출·공통 증빙 PDF도 모두 이미지로 마이그레이션한다", async () => {
    const project = createEmptyProject();
    project.projectDirectory = "/project";
    project.expenses = [{
      id: "expense",
      createdOrder: 1,
      category: "transport",
      date: "2026-07-20",
      content: "교통비",
      amount: 10_000,
      note: "",
      receiptMode: "online-printable",
      originalConfirmed: false,
      attachments: [pdfAttachment],
      itemDetails: "",
      isFuel: false,
      paymentSource: "team",
      settlementTargetAmount: 0,
      settledAmount: 0,
      settlementStatus: "not-applicable",
    } satisfies Expense];
    project.categoryEvidence = [{
      id: "evidence",
      category: "transport",
      kind: "fuel-calculation",
      title: "주유비 산정 증빙",
      attachments: [{ ...pdfAttachment, id: "fuel-pdf", relativePath: "attachments/fuel.pdf" }],
    }];

    const result = await normalizeProjectAttachmentsToImages(project);

    expect(result.convertedPdfCount).toBe(2);
    expect(result.generatedImageCount).toBe(4);
    expect(result.failures).toEqual([]);
    expect(result.project.expenses[0].attachments.every((attachment) => attachment.mimeType === "image/png")).toBe(true);
    expect(result.project.categoryEvidence[0].attachments.every((attachment) => attachment.mimeType === "image/png")).toBe(true);
  });
});
