// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyProject, type Attachment, type Expense } from "../types";

const mocks = vi.hoisted(() => ({
  deleteAttachmentFile: vi.fn(),
  destroyDocument: vi.fn(),
  getDocument: vi.fn(),
  heicTo: vi.fn(async () => ({
    arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
  } as Blob)),
  isHeic: vi.fn(async () => true),
  readAttachmentBytes: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  writeAttachmentBytes: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: mocks.getDocument,
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf-worker.js" }));
vi.mock("heic-to/csp", () => ({
  heicTo: mocks.heicTo,
  isHeic: mocks.isHeic,
}));
vi.mock("./desktop", () => ({
  attachmentAbsolutePath: (directory: string, relativePath: string) => `${directory}/${relativePath}`,
  ...mocks,
}));

import { attachmentNeedsImageNormalization, normalizeAttachmentToImages, normalizeProjectAttachmentsToImages } from "./pdf-to-images";

const pdfAttachment: Attachment = {
  id: "pdf",
  relativePath: "attachments/source.pdf",
  originalName: "긴 영수증.pdf",
  mimeType: "application/pdf",
  kind: "online-receipt",
};

const heifAttachment: Attachment = {
  id: "heif",
  relativePath: "attachments/source.HEIC",
  originalName: "아이폰 영수증.HEIC",
  mimeType: "image/heic",
  kind: "online-receipt",
};

describe("PDF·HEIF 첨부 이미지 변환", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocument.mockReturnValue({
      destroy: mocks.destroyDocument,
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({
          getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 900 * scale }),
          render: () => ({ promise: Promise.resolve() }),
        }),
      }),
    });
    vi.stubGlobal("Image", class {
      src = "";
      naturalWidth = 4000;
      naturalHeight = 3000;
      decode = vi.fn(async () => undefined);
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D);
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
    expect(images.every((image) => image.previewRelativePath?.endsWith(".jpg"))).toBe(true);
    expect(mocks.writeAttachmentBytes).toHaveBeenCalledTimes(4);
    expect(mocks.destroyDocument).toHaveBeenCalledOnce();
    expect(mocks.deleteAttachmentFile).toHaveBeenCalledWith("/project/attachments/source.pdf");
    expect(mocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({
      cMapPacked: true,
      cMapUrl: expect.stringContaining("/pdfjs/cmaps/"),
      standardFontDataUrl: expect.stringContaining("/pdfjs/standard_fonts/"),
      useSystemFonts: true,
    }));
  });

  it("이미지 첨부는 변환하지 않고 그대로 돌려준다", async () => {
    const image = { ...pdfAttachment, mimeType: "image/png", originalName: "긴 영수증.png", relativePath: "attachments/source.png" };
    const [prepared] = await normalizeAttachmentToImages("/project", image);
    expect(prepared).toMatchObject({ ...image, previewMimeType: "image/jpeg", previewPrepared: true });
    expect(prepared.previewRelativePath).toMatch(/^attachments\/preview-.*\.jpg$/);
    expect(mocks.writeAttachmentBytes).toHaveBeenCalledOnce();
  });

  it("아이폰 HEIF 원본을 보존하고 고화질 JPEG 렌더링 이미지를 만든다", async () => {
    const images = await normalizeAttachmentToImages("/project", heifAttachment);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      id: "heif",
      relativePath: "attachments/source.HEIC",
      originalName: "아이폰 영수증.HEIC",
      mimeType: "image/heic",
      renderMimeType: "image/jpeg",
      previewMimeType: "image/jpeg",
      previewPrepared: true,
      kind: "online-receipt",
    });
    expect(images[0].renderRelativePath).toMatch(/^attachments\/heif-render-.*\.jpg$/);
    expect(images[0].previewRelativePath).toMatch(/^attachments\/preview-.*\.jpg$/);
    expect(mocks.isHeic).toHaveBeenCalledOnce();
    expect(mocks.heicTo).toHaveBeenCalledWith(expect.objectContaining({ type: "image/jpeg", quality: 0.92 }));
    expect(mocks.writeAttachmentBytes).toHaveBeenCalledTimes(2);
    expect(mocks.deleteAttachmentFile).not.toHaveBeenCalledWith("/project/attachments/source.HEIC");
  });

  it("기존 프로젝트의 지출·공통 증빙 PDF와 HEIF를 모두 이미지로 마이그레이션한다", async () => {
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
      attachments: [pdfAttachment, heifAttachment],
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
    expect(result.convertedHeifCount).toBe(1);
    expect(result.generatedImageCount).toBe(5);
    expect(result.preparedAttachmentCount).toBe(3);
    expect(result.generatedPreviewCount).toBe(5);
    expect(result.failures).toEqual([]);
    expect(result.project.expenses[0].attachments.every((attachment) => !attachmentNeedsImageNormalization(attachment))).toBe(true);
    expect(result.project.expenses[0].attachments.every((attachment) => attachment.previewPrepared)).toBe(true);
    expect(result.project.categoryEvidence[0].attachments.every((attachment) => attachment.mimeType === "image/png")).toBe(true);
  });
});
