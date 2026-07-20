import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { packageReceiptBookDocx } from "./receipt-docx";

describe("영수증철 Word 내보내기", () => {
  it("각 영수증철 페이지를 A4 전체 페이지 그림으로 넣은 DOCX를 만든다", async () => {
    const bytes = await packageReceiptBookDocx([
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    ], "테스트 & 영수증철");
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const relationships = await zip.file("word/_rels/document.xml.rels")!.async("string");
    const coreProperties = await zip.file("docProps/core.xml")!.async("string");

    expect(zip.file("word/media/receipt-page-1.jpeg")).not.toBeNull();
    expect(zip.file("word/media/receipt-page-2.jpeg")).not.toBeNull();
    expect(documentXml.match(/<wp:anchor /g)).toHaveLength(2);
    expect(documentXml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
    expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(documentXml).toContain('<wp:extent cx="7560000" cy="10692000"/>');
    expect(relationships).toContain('Target="media/receipt-page-2.jpeg"');
    expect(coreProperties).toContain("테스트 &amp; 영수증철");
  });
});
