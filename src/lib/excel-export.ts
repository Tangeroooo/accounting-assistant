import JSZip from "jszip";
import templateUrl from "../../resources/accounting-template.xlsx?url";
import { CATEGORY_DEFINITIONS, getCategory, type Expense, type ProjectData } from "../types";
import { applyDerivedState, isAutoTeamMinistryNote, teamMinistryExpenseTotal } from "./accounting";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

const TEMPLATE_RANGES = [
  { id: "transport", start: 5, total: 10 },
  { id: "lodging", start: 11, total: 14 },
  { id: "meals", start: 15, total: 23 },
  { id: "ministry", start: 24, total: 28 },
  { id: "gifts", start: 29, total: 33 },
  { id: "teamMinistry", start: 34, total: 39 },
  { id: "offering", start: 40, total: 41 },
  { id: "misc", start: 42, total: 46 },
] as const;

type XmlDocument = Document;

const parseXml = (value: string) => {
  const document = new DOMParser().parseFromString(value, "application/xml");
  const error = document.querySelector("parsererror");
  if (error) throw new Error(`엑셀 XML을 읽지 못했습니다: ${error.textContent}`);
  return document;
};

const serializeXml = (document: XmlDocument) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${new XMLSerializer()
    .serializeToString(document.documentElement)
    .replace(/^<\?xml[^>]*>/, "")}`;

const columnNumber = (reference: string) => {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? "A";
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
};

const rowNumber = (reference: string) => Number(reference.match(/\d+$/)?.[0] ?? 0);

const all = <T extends Element>(parent: ParentNode, selector: string) =>
  [...parent.querySelectorAll(selector)] as T[];

const cellAt = (document: XmlDocument, row: number, column: string) =>
  document.querySelector(`c[r="${column}${row}"]`) as Element | null;

const cloneCell = (
  document: XmlDocument,
  source: Element | null,
  column: string,
  row: number,
) => {
  const cell = source ? (source.cloneNode(true) as Element) : document.createElementNS(NS, "c");
  cell.setAttribute("r", `${column}${row}`);
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.removeAttribute("t");
  return cell;
};

const cloneRawCell = (source: Element, column: string, row: number) => {
  const cell = source.cloneNode(true) as Element;
  cell.setAttribute("r", `${column}${row}`);
  return cell;
};

const setText = (document: XmlDocument, cell: Element, value: string) => {
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.setAttribute("t", "inlineStr");
  const inline = document.createElementNS(NS, "is");
  const text = document.createElementNS(NS, "t");
  if (/^\s|\s$/.test(value)) text.setAttribute("xml:space", "preserve");
  text.textContent = value;
  inline.appendChild(text);
  cell.appendChild(inline);
};

/**
 * Excel for macOS repairs inline strings added to this Microsoft-authored
 * template. Move every generated text value into the workbook's existing
 * shared-string table before the package is written.
 */
const moveInlineStringsToSharedStrings = (
  sharedStringsDocument: XmlDocument,
  worksheetDocuments: XmlDocument[],
) => {
  const sharedStrings = sharedStringsDocument.documentElement;
  let nextIndex = all<Element>(sharedStrings, ":scope > si").length;

  for (const worksheet of worksheetDocuments) {
    for (const cell of all<Element>(worksheet, 'c[t="inlineStr"]')) {
      const value = all<Element>(cell, "is t")
        .map((node) => node.textContent ?? "")
        .join("");
      const item = sharedStringsDocument.createElementNS(NS, "si");
      const text = sharedStringsDocument.createElementNS(NS, "t");
      if (/^\s|\s$/.test(value)) text.setAttribute("xml:space", "preserve");
      text.textContent = value;
      item.appendChild(text);
      sharedStrings.appendChild(item);

      while (cell.firstChild) cell.removeChild(cell.firstChild);
      cell.setAttribute("t", "s");
      const reference = worksheet.createElementNS(NS, "v");
      reference.textContent = String(nextIndex);
      cell.appendChild(reference);
      nextIndex += 1;
    }
  }

  sharedStrings.setAttribute("uniqueCount", String(nextIndex));
};

const countSharedStringReferences = (document: XmlDocument) =>
  all<Element>(document, 'c[t="s"]').length;

const setNumber = (document: XmlDocument, cell: Element, value: number) => {
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.removeAttribute("t");
  const node = document.createElementNS(NS, "v");
  node.textContent = Number.isFinite(value) ? String(value) : "0";
  cell.appendChild(node);
};

const setFormula = (document: XmlDocument, cell: Element, formula: string, cached = 0) => {
  const existingFormula = cell.querySelector(":scope > f") as Element | null;
  const sharedFormula = existingFormula?.getAttribute("t") === "shared"
    ? (existingFormula.cloneNode(true) as Element)
    : null;
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.removeAttribute("t");
  const formulaNode = sharedFormula ?? document.createElementNS(NS, "f");
  if (!sharedFormula || formulaNode.textContent?.trim()) formulaNode.textContent = formula;
  const valueNode = document.createElementNS(NS, "v");
  valueNode.textContent = String(cached);
  cell.append(formulaNode, valueNode);
};

const formatLedgerDate = (date: string) => {
  if (!date) return "";
  const [, month, day] = date.split("-");
  return `${month}월 ${day}일`;
};

const expenseContent = (expense: Expense) => {
  const category = getCategory(expense.category).label;
  const content = expense.content.trim().replace(/^\[[^\]]+\]\s*/, "");
  const taggedContent = `[${category}] ${content}`;
  const details = expense.itemDetails.trim();
  if (expense.category === "meals" && expense.mealHeadcount) {
    return `${taggedContent}_${expense.mealHeadcount}명${details ? `_${details}` : ""}`;
  }
  return details ? `${taggedContent}_${details}` : taggedContent;
};

const excelCharacterWidth = (character: string) => {
  if (/\p{Mark}/u.test(character)) return 0;
  if (character === "\t") return 4;
  if (character === " ") return 0.5;
  // 맑은 고딕에서 한글·한자·일본어·전각문자·이모지는 숫자/영문보다 넓다.
  if (/[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︐-﹯＀-｠￠-￦]|\p{Extended_Pictographic}/u.test(character)) {
    return 1.5;
  }
  return 1;
};

const wrappedLineCount = (value: string, excelColumnWidth: number) => {
  // 셀 안쪽 여백과 단어 단위 줄바꿈 오차를 감안해 실제 열 너비의 90%만 사용한다.
  const availableWidth = Math.max(1, (excelColumnWidth - 1.5) * 0.9);
  return value.split("\n").reduce((lineCount, explicitLine) => {
    if (!explicitLine) return lineCount + 1;
    let wrappedLines = 1;
    let currentWidth = 0;
    for (const character of explicitLine) {
      const characterWidth = excelCharacterWidth(character);
      if (currentWidth > 0 && currentWidth + characterWidth > availableWidth) {
        wrappedLines += 1;
        currentWidth = characterWidth;
      } else {
        currentWidth += characterWidth;
      }
    }
    return lineCount + wrappedLines;
  }, 0);
};

const ledgerRowHeight = (
  expense: Expense,
  contentColumnWidth: number,
  noteColumnWidth: number,
) => {
  const contentLines = wrappedLineCount(expenseContent(expense), contentColumnWidth);
  const noteLines = expense.note ? wrappedLineCount(expense.note, noteColumnWidth) : 1;
  const requiredLines = Math.max(1, contentLines, noteLines);
  return Math.min(409.5, requiredLines === 1 ? 16.5 : requiredLines * 16.5 + 2);
};

const formatKoreanDate = (date: string) => {
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
};

const updateTextCell = (document: XmlDocument, reference: string, value: string) => {
  const cell = document.querySelector(`c[r="${reference}"]`) as Element | null;
  if (!cell) throw new Error(`공식 템플릿 셀 ${reference}을 찾지 못했습니다.`);
  setText(document, cell, value);
};

const clearCellContent = (document: XmlDocument, reference: string) => {
  const cell = document.querySelector(`c[r="${reference}"]`) as Element | null;
  if (!cell) throw new Error(`공식 템플릿 셀 ${reference}을 찾지 못했습니다.`);
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.removeAttribute("t");
};

const updateNumberCell = (document: XmlDocument, reference: string, value: number) => {
  const cell = document.querySelector(`c[r="${reference}"]`) as Element | null;
  if (!cell) throw new Error(`공식 템플릿 셀 ${reference}을 찾지 못했습니다.`);
  setNumber(document, cell, value);
};

const updateFormulaCell = (
  document: XmlDocument,
  reference: string,
  formula: string,
  cached: number,
) => {
  const cell = document.querySelector(`c[r="${reference}"]`) as Element | null;
  if (!cell) throw new Error(`공식 템플릿 셀 ${reference}을 찾지 못했습니다.`);
  setFormula(document, cell, formula, cached);
};

function updateAccountingReport(document: XmlDocument, project: ProjectData) {
  const income = {
    dues: project.incomes.filter((item) => item.type === "dues").reduce((sum, item) => sum + item.amount, 0),
    teamSupport: project.incomes.filter((item) => item.type === "teamSupport").reduce((sum, item) => sum + item.amount, 0),
    flowing: project.incomes.filter((item) => item.type === "flowing").reduce((sum, item) => sum + item.amount, 0),
  };
  const categoryTotals = Object.fromEntries(
    CATEGORY_DEFINITIONS.map((definition) => [
      definition.id,
      project.expenses
        .filter((expense) => expense.category === definition.id)
        .reduce((sum, expense) => sum + expense.amount, 0),
    ]),
  ) as Record<(typeof CATEGORY_DEFINITIONS)[number]["id"], number>;
  const totalIncome = income.dues + income.teamSupport + income.flowing;
  const totalExpense = Object.values(categoryTotals).reduce((sum, value) => sum + value, 0);
  const returnAmount = Math.max(income.teamSupport - teamMinistryExpenseTotal(project.expenses), 0);

  updateTextCell(document, "D4", `이름 : ${project.meta.accountantName}`);
  updateTextCell(document, "E4", `이름 : ${project.meta.pastorName}`);
  updateTextCell(document, "A6", ` ▶ 공동체 : ${project.meta.community}`);
  clearCellContent(document, "B6");
  updateTextCell(document, "C6", `그룹명 : ${project.meta.groupName}`);
  updateTextCell(document, "A7", ` ▶ 사역지(지역/교회명or지역/단체명) : ${project.meta.destination}`);
  updateTextCell(
    document,
    "A8",
    ` ▶ 기  간 : ${formatKoreanDate(project.meta.startDate)}~${formatKoreanDate(project.meta.endDate)}`,
  );
  updateTextCell(document, "A9", ` ▶ 총인원 : ${project.meta.headcount}명`);
  updateTextCell(
    document,
    "A10",
    `     - 팀 장 : ${project.meta.leaderName} (연락처 : ${project.meta.leaderPhone})`,
  );
  updateTextCell(
    document,
    "A11",
    `     - 회 계 : ${project.meta.accountantName} (연락처 : ${project.meta.accountantPhone})`,
  );
  updateTextCell(document, "A12", ` ▶  제   출   일 : ${formatKoreanDate(project.meta.submissionDate)}`);

  updateNumberCell(document, "B16", income.dues);
  updateNumberCell(document, "B17", income.teamSupport);
  updateNumberCell(document, "B18", income.flowing);
  CATEGORY_DEFINITIONS.forEach((definition, index) =>
    updateNumberCell(document, `E${16 + index}`, categoryTotals[definition.id]),
  );
  updateFormulaCell(document, "B24", "SUM(B16:C19)", totalIncome);
  updateFormulaCell(document, "E24", "SUM(E16:E23)", totalExpense);
  updateNumberCell(document, "E25", returnAmount);
}

function updateCommunitySummary(document: XmlDocument, project: ProjectData) {
  const incomeByType = (type: ProjectData["incomes"][number]["type"]) =>
    project.incomes.filter((item) => item.type === type).reduce((sum, item) => sum + item.amount, 0);
  const categoryTotals = CATEGORY_DEFINITIONS.map((definition) =>
    project.expenses
      .filter((expense) => expense.category === definition.id)
      .reduce((sum, expense) => sum + expense.amount, 0),
  );
  const incomeValues = [incomeByType("dues"), incomeByType("teamSupport"), incomeByType("flowing")];
  const totalIncome = incomeValues.reduce((sum, value) => sum + value, 0);
  const totalExpense = categoryTotals.reduce((sum, value) => sum + value, 0);

  updateTextCell(
    document,
    "A1",
    `[${project.meta.community || "○○○"} 공동체 ] 2026년 여름 아웃리치 회계보고 - 국내`,
  );
  updateTextCell(document, "B6", project.meta.destination || project.meta.teamName);
  updateNumberCell(document, "C6", project.meta.headcount);
  ["D6", "E6", "F6"].forEach((reference, index) =>
    updateNumberCell(document, reference, incomeValues[index]),
  );
  updateFormulaCell(document, "G6", "SUM(D6:F6)", totalIncome);
  ["H6", "I6", "J6", "K6", "L6", "M6", "N6", "O6"].forEach((reference, index) =>
    updateNumberCell(document, reference, categoryTotals[index]),
  );
  updateFormulaCell(document, "P6", "SUM(H6:O6)", totalExpense);

  ["D26", "E26", "F26"].forEach((reference, index) =>
    updateFormulaCell(document, reference, `SUM(${reference[0]}6:${reference[0]}25)`, incomeValues[index]),
  );
  updateFormulaCell(document, "G26", "SUM(G6:G25)", totalIncome);
  ["H26", "I26", "J26", "K26", "L26", "M26", "N26", "O26"].forEach((reference, index) =>
    updateFormulaCell(
      document,
      reference,
      `SUM(${reference[0]}6:${reference[0]}25)`,
      categoryTotals[index],
    ),
  );
  updateFormulaCell(document, "P26", "SUM(P6:P25)", totalExpense);
}

const ensureRow = (document: XmlDocument, sheetData: Element, rowIndex: number) => {
  const existing = sheetData.querySelector(`row[r="${rowIndex}"]`) as Element | null;
  if (existing) return existing;
  const row = document.createElementNS(NS, "row");
  row.setAttribute("r", String(rowIndex));
  row.setAttribute("spans", "1:13");
  row.setAttribute("ht", "16.5");
  row.setAttribute("customHeight", "1");
  const next = all<Element>(sheetData, ":scope > row").find(
    (candidate) => Number(candidate.getAttribute("r")) > rowIndex,
  );
  sheetData.insertBefore(row, next ?? null);
  return row;
};

const setRowHeight = (row: Element, height: number) => {
  row.setAttribute("ht", String(height));
  row.setAttribute("customHeight", "1");
};

const appendCellOrdered = (row: Element, cell: Element) => {
  const number = columnNumber(cell.getAttribute("r") ?? "A1");
  const next = all<Element>(row, ":scope > c").find(
    (candidate) => columnNumber(candidate.getAttribute("r") ?? "A1") > number,
  );
  row.insertBefore(cell, next ?? null);
};

const rangeInfo = (range: string) => {
  const [start, end = start] = range.split(":");
  return {
    startColumn: columnNumber(start),
    endColumn: columnNumber(end),
    startRow: rowNumber(start),
    endRow: rowNumber(end),
  };
};

const worksheetColumnWidth = (document: XmlDocument, column: number, fallback: number) => {
  const definition = all<Element>(document, "cols col").find((candidate) => {
    const min = Number(candidate.getAttribute("min"));
    const max = Number(candidate.getAttribute("max"));
    return min <= column && column <= max;
  });
  const width = Number(definition?.getAttribute("width"));
  return Number.isFinite(width) && width > 0 ? width : fallback;
};

function replaceLedger(document: XmlDocument, project: ProjectData) {
  const sheetData = document.querySelector("sheetData");
  const mergeCells = document.querySelector("mergeCells");
  if (!sheetData || !mergeCells) throw new Error("금전출납부 시트 구조가 예상과 다릅니다.");
  updateTextCell(
    document,
    "A1",
    `${project.meta.community || "○○○"} 공동체 -국내 ${project.meta.teamName || "○○○팀"} - 금전출납부`,
  );

  const styleSources = TEMPLATE_RANGES.map((range) => ({
    id: range.id,
    first: Object.fromEntries(
      ["A", "B", "C", "D", "E", "F"].map((column) => [
        column,
        cellAt(document, range.start, column),
      ]),
    ),
    middle: Object.fromEntries(
      ["A", "B", "C", "D", "E", "F"].map((column) => [
        column,
        cellAt(document, Math.min(range.start + 1, range.total - 1), column),
      ]),
    ),
    total: Object.fromEntries(
      ["A", "B", "C", "D", "E", "F"].map((column) => [
        column,
        cellAt(document, range.total, column),
      ]),
    ),
  }));
  const grandTotalSources = Object.fromEntries(
    ["A", "B", "C", "D", "E", "F"].map((column) => [column, cellAt(document, 47, column)]),
  );
  const footerSources = [49, 50].map((row) =>
    Object.fromEntries(
      ["A", "B", "C", "D", "E", "F"].map((column) => [column, cellAt(document, row, column)]),
    ),
  );
  const teamMinistryAutoNoteStyle = cellAt(document, 34, "M");
  const dimension = document.querySelector("dimension");
  const templateMaxRow = rangeInfo(dimension?.getAttribute("ref") ?? "A1").endRow;
  const contentColumnWidth = worksheetColumnWidth(document, 3, 74);
  const noteColumnWidth = worksheetColumnWidth(document, 6, 11.33203125);

  for (const row of all<Element>(sheetData, ":scope > row")) {
    for (const cell of all<Element>(row, ":scope > c")) {
      const reference = cell.getAttribute("r") ?? "";
      if (rowNumber(reference) >= 5 && columnNumber(reference) <= 6) cell.remove();
    }
  }

  for (const merge of all<Element>(mergeCells, ":scope > mergeCell")) {
    const info = rangeInfo(merge.getAttribute("ref") ?? "A1");
    if (info.endColumn <= 6 && info.endRow >= 5) merge.remove();
  }

  const addMerge = (reference: string) => {
    const merge = document.createElementNS(NS, "mergeCell");
    merge.setAttribute("ref", reference);
    mergeCells.appendChild(merge);
  };

  let cursor = 5;
  const totalRows: number[] = [];
  for (const [index, definition] of CATEGORY_DEFINITIONS.entries()) {
    const sources = styleSources[index];
    const expenses = project.expenses.filter((expense) => expense.category === definition.id);
    // 오른쪽 H:N의 샘플은 설명용일 뿐 제출용 A:F의 행 수를 결정하지 않는다.
    // 각 항목에는 실제 지출(영수증) 건수만큼만 거래 행을 만든다.
    const rowCount = expenses.length;
    const start = cursor;
    const total = start + rowCount;
    totalRows.push(total);

    for (let offset = 0; offset < rowCount; offset += 1) {
      const rowIndex = start + offset;
      const row = ensureRow(document, sheetData, rowIndex);
      const style = offset === 0 ? sources.first : sources.middle;
      const expense = expenses[offset];
      setRowHeight(row, ledgerRowHeight(expense, contentColumnWidth, noteColumnWidth));
      for (const column of ["A", "B", "C", "D", "E", "F"]) {
        const useAutoNoteStyle = column === "F"
          && offset === 0
          && expense?.noteMode === "auto"
          && isAutoTeamMinistryNote(expense.note);
        const cell = cloneCell(
          document,
          useAutoNoteStyle ? teamMinistryAutoNoteStyle : style[column],
          column,
          rowIndex,
        );
        if (column === "A" && offset === 0) setText(document, cell, getCategory(definition.id).label);
        if (expense) {
          if (column === "B") setText(document, cell, formatLedgerDate(expense.date));
          if (column === "C") setText(document, cell, expenseContent(expense));
          if (column === "D") setNumber(document, cell, expense.amount);
          if (column === "E") setNumber(document, cell, expense.receiptNumber ?? offset + 1);
          if (column === "F" && expense.note) setText(document, cell, expense.note);
        }
        appendCellOrdered(row, cell);
      }
    }

    if (
      definition.id === "teamMinistry" &&
      expenses[0]?.noteMode === "auto" &&
      isAutoTeamMinistryNote(expenses[0].note)
    ) {
      const mergeEnd = Math.min(start + 2, total - 1);
      const hasConflictingNote = expenses
        .slice(1, mergeEnd - start + 1)
        .some((expense) => expense.note.trim());
      if (!hasConflictingNote && mergeEnd > start) addMerge(`F${start}:F${mergeEnd}`);
    }

    const totalRow = ensureRow(document, sheetData, total);
    setRowHeight(totalRow, 16.5);
    for (const column of ["A", "B", "C", "D", "E", "F"]) {
      const source = sources.total[column];
      // 소계 문구와 공백은 항목마다 템플릿 원문을 그대로 보존한다.
      const cell = column === "B" && source
        ? cloneRawCell(source, column, total)
        : cloneCell(document, source, column, total);
      if (column === "A" && rowCount === 0) {
        setText(document, cell, getCategory(definition.id).label);
      }
      if (column === "D") {
        const cached = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        if (rowCount === 0) setNumber(document, cell, 0);
        else setFormula(document, cell, `SUM(D${start}:D${total - 1})`, cached);
      }
      appendCellOrdered(totalRow, cell);
    }
    if (rowCount > 0) addMerge(`A${start}:A${total}`);
    addMerge(`B${total}:C${total}`);
    cursor = total + 1;
  }

  const grandTotalRow = cursor;
  const grandTotal = project.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const row = ensureRow(document, sheetData, grandTotalRow);
  setRowHeight(row, 16.5);
  for (const column of ["A", "B", "C", "D", "E", "F"]) {
    const cell = cloneCell(document, grandTotalSources[column], column, grandTotalRow);
    if (column === "A") setText(document, cell, "지출합계");
    if (column === "C") {
      setFormula(
        document,
        cell,
        totalRows.map((totalRow) => `D${totalRow}`).join("+"),
        grandTotal,
      );
    }
    appendCellOrdered(row, cell);
  }
  addMerge(`A${grandTotalRow}:B${grandTotalRow}`);
  addMerge(`C${grandTotalRow}:D${grandTotalRow}`);

  const footerStart = grandTotalRow + 2;
  footerSources.forEach((sources, index) => {
    const footerRowIndex = footerStart + index;
    const footerRow = ensureRow(document, sheetData, footerRowIndex);
    setRowHeight(footerRow, 16.5);
    for (const column of ["A", "B", "C", "D", "E", "F"]) {
      const source = sources[column];
      if (!source) continue;
      appendCellOrdered(footerRow, cloneRawCell(source, column, footerRowIndex));
    }
  });
  addMerge(`A${footerStart}:C${footerStart}`);
  addMerge(`A${footerStart + 1}:D${footerStart + 1}`);

  mergeCells.setAttribute("count", String(mergeCells.querySelectorAll("mergeCell").length));
  const printMaxRow = footerStart + 1;
  // 오른쪽 샘플은 그대로 보존되므로 시트 dimension은 그 범위를 포함해야 한다.
  // 제출용 인쇄영역의 마지막 행은 별도로 printMaxRow를 사용한다.
  dimension?.setAttribute("ref", `A1:N${Math.max(templateMaxRow, printMaxRow)}`);
  return { grandTotalRow, printMaxRow };
}

function updatePrintArea(document: XmlDocument, maxRow: number) {
  const names = all<Element>(document, "definedName");
  const ledgerArea = names.find(
    (node) => node.getAttribute("name") === "_xlnm.Print_Area" && node.getAttribute("localSheetId") === "2",
  );
  if (ledgerArea) ledgerArea.textContent = `'국내-금전출납부'!$A$1:$F$${maxRow}`;
  const calculation = document.querySelector("calcPr");
  calculation?.setAttribute("fullCalcOnLoad", "1");
  calculation?.setAttribute("forceFullCalc", "1");
}

export async function createAccountingWorkbook(projectInput: ProjectData) {
  const project = applyDerivedState(projectInput);
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error("번들된 공식 회계 템플릿을 읽지 못했습니다.");
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const sheetFile = zip.file("xl/worksheets/sheet3.xml");
  const workbookFile = zip.file("xl/workbook.xml");
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  if (!sheetFile || !workbookFile || !sharedStringsFile) {
    throw new Error("공식 템플릿 구조가 예상과 다릅니다.");
  }

  const ledgerDocument = parseXml(await sheetFile.async("string"));
  const { printMaxRow } = replaceLedger(ledgerDocument, project);

  const reportFile = zip.file("xl/worksheets/sheet2.xml");
  const summaryFile = zip.file("xl/worksheets/sheet1.xml");
  if (!reportFile || !summaryFile) throw new Error("공식 회계보고서 시트를 찾지 못했습니다.");
  const reportDocument = parseXml(await reportFile.async("string"));
  updateAccountingReport(reportDocument, project);
  const summaryDocument = parseXml(await summaryFile.async("string"));
  updateCommunitySummary(summaryDocument, project);

  const sharedStringsDocument = parseXml(await sharedStringsFile.async("string"));
  const changedWorksheets = [summaryDocument, reportDocument, ledgerDocument];
  moveInlineStringsToSharedStrings(sharedStringsDocument, changedWorksheets);

  let sharedStringReferenceCount = changedWorksheets.reduce(
    (sum, document) => sum + countSharedStringReferences(document),
    0,
  );
  for (const sheetNumber of [4, 5, 6]) {
    const unchangedSheet = zip.file(`xl/worksheets/sheet${sheetNumber}.xml`);
    if (!unchangedSheet) continue;
    sharedStringReferenceCount += countSharedStringReferences(
      parseXml(await unchangedSheet.async("string")),
    );
  }
  sharedStringsDocument.documentElement.setAttribute("count", String(sharedStringReferenceCount));

  zip.file("xl/worksheets/sheet1.xml", serializeXml(summaryDocument));
  zip.file("xl/worksheets/sheet2.xml", serializeXml(reportDocument));
  zip.file("xl/worksheets/sheet3.xml", serializeXml(ledgerDocument));
  zip.file("xl/sharedStrings.xml", serializeXml(sharedStringsDocument));

  const workbookDocument = parseXml(await workbookFile.async("string"));
  updatePrintArea(workbookDocument, printMaxRow);
  zip.file("xl/workbook.xml", serializeXml(workbookDocument));

  // 값이 바뀐 파일은 Excel이 전체 수식을 다시 계산하도록 기존 캐시 체인을 제거합니다.
  zip.remove("xl/calcChain.xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (relsFile) {
    const rels = parseXml(await relsFile.async("string"));
    for (const relationship of all<Element>(rels, "Relationship")) {
      if (relationship.getAttribute("Type")?.endsWith("/calcChain")) relationship.remove();
    }
    zip.file("xl/_rels/workbook.xml.rels", serializeXml(rels));
  }
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (contentTypesFile) {
    const contentTypes = parseXml(await contentTypesFile.async("string"));
    for (const override of all<Element>(contentTypes, "Override")) {
      if (override.getAttribute("PartName") === "/xl/calcChain.xml") override.remove();
    }
    zip.file("[Content_Types].xml", serializeXml(contentTypes));
  }

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
