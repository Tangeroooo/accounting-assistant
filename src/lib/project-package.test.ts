import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { createEmptyProject } from "../types";
import { BARUN_FORMAT, collectProjectAssetPaths, createBarunPackage, parseBarunPackage } from "./project-package";

describe(".barun 프로젝트 패키지", () => {
  it("프로젝트 데이터와 첨부파일을 한 파일에 담고 절대 작업 경로는 제외한다", async () => {
    const project = createEmptyProject();
    project.projectDirectory = "/private/work/project";
    project.meta.teamName = "강릉팀";
    project.expenses = [{
      id: "expense",
      createdOrder: 1,
      category: "transport",
      date: "2026-07-01",
      content: "버스",
      amount: 10_000,
      note: "",
      receiptMode: "online-printable",
      originalConfirmed: false,
      attachments: [{ id: "receipt", relativePath: "attachments/receipt.png", originalName: "receipt.png", mimeType: "image/png", kind: "online-receipt", layout: { widthMm: 86, heightMm: 48, aspectRatio: 0.67, fit: "cover", scale: 1.35, offsetX: 12, offsetY: -7, rotation: 90 } }],
      offlineHolders: [{ id: "holder", widthMm: 55, heightMm: 100 }],
      itemDetails: "",
      isFuel: false,
      paymentSource: "team",
      settlementTargetAmount: 0,
      settledAmount: 0,
      settlementStatus: "not-applicable",
    }];
    project.categoryEvidence = [{
      id: "fuel-evidence",
      category: "transport",
      kind: "fuel-calculation",
      title: "주유비 산정 증빙",
      attachments: [{ id: "fuel", relativePath: "attachments/fuel.png", originalName: "fuel.png", mimeType: "image/png", kind: "other" }],
      offlineHolders: [{ id: "fuel-holder", widthMm: 92, heightMm: 68 }],
    }];
    const bytes = await createBarunPackage(project, async () => new Uint8Array([1, 2, 3]));
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));

    expect(manifest.format).toBe(BARUN_FORMAT);
    expect(manifest.project.projectDirectory).toBeUndefined();
    expect(await zip.file("attachments/receipt.png")!.async("uint8array")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await zip.file("attachments/fuel.png")!.async("uint8array")).toEqual(new Uint8Array([1, 2, 3]));

    const parsed = await parseBarunPackage(bytes);
    expect(parsed.project.meta.teamName).toBe("강릉팀");
    expect(parsed.project.expenses[0].attachments[0].layout).toEqual({ widthMm: 86, heightMm: 48, aspectRatio: 0.67, fit: "cover", scale: 1.35, offsetX: 12, offsetY: -7, rotation: 90 });
    expect(parsed.project.expenses[0].offlineHolders).toEqual([{ id: "holder", widthMm: 55, heightMm: 100 }]);
    expect(parsed.project.categoryEvidence[0].offlineHolders).toEqual([{ id: "fuel-holder", widthMm: 92, heightMm: 68 }]);
    expect(parsed.assets.get("attachments/receipt.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect(parsed.assets.get("attachments/fuel.png")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("프로젝트가 참조하는 첨부 이미지가 빠진 패키지는 열지 않는다", async () => {
    const project = createEmptyProject();
    project.expenses = [{
      id: "expense",
      createdOrder: 1,
      category: "transport",
      date: "2026-07-01",
      content: "버스",
      amount: 10_000,
      note: "",
      receiptMode: "online-printable",
      originalConfirmed: false,
      attachments: [{ id: "receipt", relativePath: "attachments/receipt.png", originalName: "receipt.png", mimeType: "image/png", kind: "online-receipt" }],
      offlineHolders: [],
      itemDetails: "",
      isFuel: false,
      paymentSource: "team",
      settlementTargetAmount: 0,
      settledAmount: 0,
      settlementStatus: "not-applicable",
    }];
    const valid = await createBarunPackage(project, async () => new Uint8Array([1, 2, 3]));
    const zip = await JSZip.loadAsync(valid);
    zip.remove("attachments/receipt.png");
    const missingAttachment = await zip.generateAsync({ type: "uint8array" });

    await expect(parseBarunPackage(missingAttachment)).rejects.toThrow("첨부 이미지 1개");
  });

  it("참조된 첨부 경로를 중복 없이 수집하고 위험한 경로는 제외한다", () => {
    const project = createEmptyProject();
    const attachment = { id: "same", relativePath: "attachments/same.png", originalName: "same.png", mimeType: "image/png", kind: "other" as const };
    project.categoryEvidence = [{ id: "evidence", category: "transport", kind: "other", title: "증빙", attachments: [attachment, attachment, { ...attachment, id: "bad", relativePath: "attachments/../secret" }] }];
    expect(collectProjectAssetPaths(project)).toEqual(["attachments/same.png"]);
  });
});
