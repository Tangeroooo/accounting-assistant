import JSZip from "jszip";

import type { ProjectData } from "../types";

const A4_WIDTH_DXA = 11_906;
const A4_HEIGHT_DXA = 16_838;
const EMU_PER_MM = 36_000;

// compact_reference_guide의 Calibri 11pt·6pt 뒤 간격·1.25줄을 기본값으로 사용한다.
// 영수증철 예외: A4 0mm 여백에 14pt 텍스트 헤더와 페이지 기준 개별 그림 개체를 배치한다.

export interface ReceiptDocxObject {
  bytes: Uint8Array;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  name: string;
  description: string;
}

export interface ReceiptDocxPage {
  title: string;
  objects: ReceiptDocxObject[];
}

const escapeXml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const millimetersToEmu = (value: number) => Math.round(value * EMU_PER_MM);

function dataUrlBytes(dataUrl: string) {
  const encoded = dataUrl.split(",", 2)[1];
  if (!encoded) throw new Error("Word 문서에 넣을 영수증 개체를 만들지 못했습니다.");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function objectDrawing(object: ReceiptDocxObject, drawingIndex: number) {
  const drawingId = drawingIndex + 1;
  const relationshipId = `rIdImage${drawingId}`;
  const widthEmu = millimetersToEmu(object.widthMm);
  const heightEmu = millimetersToEmu(object.heightMm);
  return `<w:r><w:drawing>
    <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251658240 + drawingIndex}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
      <wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="page"><wp:posOffset>${millimetersToEmu(object.xMm)}</wp:posOffset></wp:positionH>
      <wp:positionV relativeFrom="page"><wp:posOffset>${millimetersToEmu(object.yMm)}</wp:posOffset></wp:positionV>
      <wp:extent cx="${widthEmu}" cy="${heightEmu}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:wrapNone/>
      <wp:docPr id="${drawingId}" name="${escapeXml(object.name)}" descr="${escapeXml(object.description)}"/>
      <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="0"/></wp:cNvGraphicFramePr>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic>
          <pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${escapeXml(object.name)}"/><pic:cNvPicPr preferRelativeResize="1"/></pic:nvPicPr>
          <pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
          <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
        </pic:pic>
      </a:graphicData></a:graphic>
    </wp:anchor>
  </w:drawing></w:r>`;
}

function pageContent(page: ReceiptDocxPage, pageIndex: number, firstDrawingIndex: number) {
  const pageBreak = pageIndex > 0 ? "<w:pageBreakBefore/>" : "";
  const drawings = page.objects.map((object, index) => objectDrawing(object, firstDrawingIndex + index)).join("\n");
  return `<w:p>
    <w:pPr><w:pStyle w:val="ReceiptHeader"/>${pageBreak}</w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Apple SD Gothic Neo" w:hAnsi="Apple SD Gothic Neo" w:eastAsia="Apple SD Gothic Neo"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="111827"/></w:rPr><w:t xml:space="preserve">${escapeXml(page.title)}</w:t></w:r>
  </w:p>
  <w:p>
    <w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>
    ${drawings}
  </w:p>`;
}

export async function packageReceiptBookDocx(pages: ReceiptDocxPage[], title = "영수증철") {
  if (pages.length === 0) throw new Error("Word로 저장할 영수증이 없습니다.");
  const zip = new JSZip();
  const createdAt = new Date().toISOString();
  const objects = pages.flatMap((page) => page.objects);
  let drawingIndex = 0;
  const pageXml = pages.map((page, pageIndex) => {
    const xml = pageContent(page, pageIndex, drawingIndex);
    drawingIndex += page.objects.length;
    return xml;
  }).join("\n");

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdOffice" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rIdApp" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title><dc:creator>아웃리치 회계</dc:creator><cp:lastModifiedBy>아웃리치 회계</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>
</cp:coreProperties>`);
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>아웃리치 회계</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><Pages>${pages.length}</Pages></Properties>`);
  zip.file("word/settings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="720"/>
  <w:characterSpacingControl w:val="doNotCompress"/>
  <w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>
</w:settings>`);
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Malgun Gothic"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="ReceiptHeader"><w:name w:val="Receipt Header"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="480" w:after="0" w:line="400" w:lineRule="exact"/></w:pPr><w:rPr><w:rFonts w:ascii="Apple SD Gothic Neo" w:hAnsi="Apple SD Gothic Neo" w:eastAsia="Apple SD Gothic Neo"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="111827"/></w:rPr></w:style>
</w:styles>`);
  const imageRelationships = objects.map((_, index) => `  <Relationship Id="rIdImage${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/receipt-object-${index + 1}.png"/>`).join("\n");
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
${imageRelationships}
</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document w:conformance="transitional" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${pageXml}
    <w:sectPr><w:pgSz w:w="${A4_WIDTH_DXA}" w:h="${A4_HEIGHT_DXA}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:space="0"/></w:sectPr>
  </w:body>
</w:document>`);
  objects.forEach((object, index) => zip.file(`word/media/receipt-object-${index + 1}.png`, object.bytes));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function createReceiptBookDocx(project: ProjectData) {
  const { renderReceiptBookObjectPages } = await import("./receipt-pdf");
  const renderedPages = await renderReceiptBookObjectPages(project);
  const pages: ReceiptDocxPage[] = renderedPages.map((page) => ({
    title: page.title,
    objects: page.objects.map((object) => ({
      bytes: dataUrlBytes(object.canvas.toDataURL("image/png")),
      xMm: object.xMm,
      yMm: object.yMm,
      widthMm: object.widthMm,
      heightMm: object.heightMm,
      name: object.name,
      description: object.description,
    })),
  }));
  const title = `${project.meta.community || "공동체"}-${project.meta.teamName || "팀"}-영수증철`;
  return packageReceiptBookDocx(pages, title);
}
