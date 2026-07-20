import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { packageReceiptBookDocx, type ReceiptDocxPage } from "./receipt-docx";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("영수증철 Word 내보내기", () => {
  it("헤더를 텍스트로, 영수증과 실물 부착 영역을 각각 독립 그림 개체로 만든다", async () => {
    const pages: ReceiptDocxPage[] = [
      {
        title: "헤더 & 텍스트",
        objects: [
          { bytes: png, xMm: 10, yMm: 25, widthMm: 82, heightMm: 62, name: "실물 부착 영역", description: "실물 영수증을 붙이는 영역" },
          { bytes: png, xMm: 96, yMm: 25, widthMm: 84, heightMm: 70, name: "영수증 1.png", description: "온라인 영수증" },
        ],
      },
      {
        title: "헤더 & 텍스트",
        objects: [
          { bytes: png, xMm: 55, yMm: 25, widthMm: 100, heightMm: 80, name: "영수증 2.png", description: "온라인 영수증" },
        ],
      },
    ];
    const bytes = await packageReceiptBookDocx(pages, "테스트 & 영수증철");
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const relationships = await zip.file("word/_rels/document.xml.rels")!.async("string");
    const styles = await zip.file("word/styles.xml")!.async("string");
    const settings = await zip.file("word/settings.xml")!.async("string");
    const coreProperties = await zip.file("docProps/core.xml")!.async("string");
    const appProperties = await zip.file("docProps/app.xml")!.async("string");

    expect(zip.file("word/media/receipt-object-1.png")).not.toBeNull();
    expect(zip.file("word/media/receipt-object-2.png")).not.toBeNull();
    expect(zip.file("word/media/receipt-object-3.png")).not.toBeNull();
    expect(zip.file("word/media/receipt-page-1.jpeg")).toBeNull();
    expect(documentXml.match(/<wp:anchor /g)).toHaveLength(3);
    expect(documentXml.match(/<w:t xml:space="preserve">헤더 &amp; 텍스트<\/w:t>/g)).toHaveLength(2);
    expect(documentXml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
    expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(documentXml).toContain('<wp:posOffset>360000</wp:posOffset>');
    expect(documentXml).toContain('<wp:extent cx="2952000" cy="2232000"/>');
    expect(documentXml).toContain('name="실물 부착 영역"');
    expect(documentXml).toContain('noChangeAspect="0"');
    expect(documentXml).toContain('w:conformance="transitional"');
    expect(relationships).toContain('Target="media/receipt-object-3.png"');
    expect(relationships).toContain('Target="settings.xml"');
    expect(styles).toContain('w:styleId="ReceiptHeader"');
    expect(settings).toContain('w:name="compatibilityMode"');
    expect(settings).toContain('w:val="15"');
    expect(appProperties).toContain("Microsoft Office Word");
    expect(appProperties).toContain("16.0000");
    expect(coreProperties).toContain("테스트 &amp; 영수증철");
  });
});
