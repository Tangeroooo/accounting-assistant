// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createEmptyProject } from "../types";
import { browserDeleteAsset, browserReadAsset, browserWriteAsset, clearBrowserAssets, replaceBrowserAssets } from "./browser-project-store";
import { createBarunPackage, parseBarunPackage } from "./project-package";

describe("웹앱 프로젝트 첨부 저장소", () => {
  afterEach(() => clearBrowserAssets());

  it("브라우저 작업공간의 이미지를 .barun에 넣고 다시 복원한다", async () => {
    const project = createEmptyProject();
    project.projectDirectory = "browser://barun-workspace";
    project.expenses = [{
      id: "expense-1",
      createdOrder: 1,
      category: "meals",
      date: "2026-07-20",
      content: "저녁 식사",
      amount: 42_000,
      note: "",
      receiptMode: "online-printable",
      originalConfirmed: false,
      attachments: [{ id: "image-1", relativePath: "attachments/receipt.png", originalName: "receipt.png", mimeType: "image/png", kind: "online-receipt" }],
      itemDetails: "",
      isFuel: false,
      paymentSource: "team",
      settlementTargetAmount: 0,
      settledAmount: 0,
      settlementStatus: "not-applicable",
    }];
    browserWriteAsset("browser://barun-workspace/attachments/receipt.png", new Uint8Array([7, 8, 9]));

    const packageBytes = await createBarunPackage(project, async (path) => browserReadAsset(path));
    clearBrowserAssets();
    const parsed = await parseBarunPackage(packageBytes);
    replaceBrowserAssets(parsed.assets);

    expect(browserReadAsset("browser://barun-workspace/attachments/receipt.png")).toEqual(new Uint8Array([7, 8, 9]));
    expect(parsed.project.expenses[0].content).toBe("저녁 식사");
  });

  it("삭제한 첨부는 더 이상 읽히지 않는다", () => {
    browserWriteAsset("attachments/deleted.png", new Uint8Array([1]));
    browserDeleteAsset("browser://barun-workspace/attachments/deleted.png");
    expect(() => browserReadAsset("attachments/deleted.png")).toThrow("첨부파일을 찾을 수 없습니다");
  });
});
