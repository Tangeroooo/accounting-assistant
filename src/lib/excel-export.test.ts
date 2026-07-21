// @vitest-environment jsdom
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountingWorkbook } from "./excel-export";
import { applyDerivedState } from "./accounting";
import { CATEGORY_DEFINITIONS, createEmptyProject, type Expense } from "../types";

const templatePath = path.resolve(process.cwd(), "resources/accounting-template.xlsx");

const sharedStringValues = (document: Document) =>
  [...document.querySelectorAll("si")].map((item) =>
    [...item.querySelectorAll("t")].map((text) => text.textContent ?? "").join(""),
  );

const sharedStringCellText = (worksheet: Document, values: string[], reference: string) => {
  const cell = worksheet.querySelector(`c[r="${reference}"]`);
  const index = Number(cell?.querySelector("v")?.textContent);
  return values[index];
};

const makeExpense = (index: number): Expense => ({
  id: `expense-${index}`,
  createdOrder: index,
  category: "transport",
  date: `2026-07-${String(20 + index).padStart(2, "0")}`,
  content: `교통비 ${index}`,
  amount: 10_000 * index,
  note: "",
  receiptMode: "offline-original",
  originalConfirmed: true,
  attachments: [],
  itemDetails: "",
  isFuel: false,
  paymentSource: index === 1 ? "personal" : "team",
  payerId: index === 1 ? "payer-secret" : undefined,
  settlementTargetAmount: index === 1 ? 10_000 : 0,
  settledAmount: 0,
  settlementStatus: index === 1 ? "pending" : "not-applicable",
});

afterEach(() => vi.unstubAllGlobals());

describe("공식 템플릿 비파괴 내보내기", () => {
  it("원본은 그대로 두고 금전출납부 행을 실제 영수증 건수에 맞추며 샘플을 보존한다", async () => {
    const originalBytes = await readFile(templatePath);
    const beforeHash = createHash("sha256").update(originalBytes).digest("hex");
    vi.stubGlobal("fetch", async () => new Response(originalBytes));

    const project = createEmptyProject();
    project.meta.community = "테스트";
    project.meta.teamName = "강릉팀";
    project.meta.headcount = 7;
    project.duesPerPerson = 40_000;
    project.people = [{ id: "payer-secret", name: "비공개 결제자", bankMemo: "비공개 계좌" }];
    project.expenses = Array.from({ length: 8 }, (_, index) => makeExpense(index + 1));
    project.expenses[0].category = "teamMinistry";
    project.expenses[0].amount = 305_850;
    project.expenses[6].itemDetails = "택시 1회";
    project.incomes = [
      { id: "income", type: "dues", amount: 280_000, receivedAt: "2026-07-01", memo: "" },
      { id: "support", type: "teamSupport", amount: 300_000, receivedAt: "2026-07-01", memo: "" },
    ];

    const outputBytes = await createAccountingWorkbook(applyDerivedState(project));
    const verificationDirectory = path.resolve(process.cwd(), "artifacts/verification");
    await mkdir(verificationDirectory, { recursive: true });
    await writeFile(path.join(verificationDirectory, "accounting-output.xlsx"), outputBytes);
    const originalZip = await JSZip.loadAsync(originalBytes);
    const outputZip = await JSZip.loadAsync(outputBytes);

    for (const path of ["xl/worksheets/sheet4.xml", "xl/worksheets/sheet5.xml", "xl/worksheets/sheet6.xml", "xl/styles.xml"]) {
      expect(await outputZip.file(path)?.async("uint8array")).toEqual(await originalZip.file(path)?.async("uint8array"));
    }

    const ledger = await outputZip.file("xl/worksheets/sheet3.xml")!.async("string");
    expect(ledger).toContain("SUM(D5:D11)");
    expect(ledger).not.toContain('t="inlineStr"');

    const sharedStrings = new DOMParser().parseFromString(
      await outputZip.file("xl/sharedStrings.xml")!.async("string"),
      "application/xml",
    );
    const sharedValues = sharedStringValues(sharedStrings);
    const ledgerDocument = new DOMParser().parseFromString(ledger, "application/xml");
    const originalLedgerDocument = new DOMParser().parseFromString(
      await originalZip.file("xl/worksheets/sheet3.xml")!.async("string"),
      "application/xml",
    );
    expect(sharedValues).toContain("[교통비] 교통비 7_택시 1회");
    expect(sharedValues).toContain("팀별사역지원금 300.000원\n팀회비\n5.850원 사용");
    expect(sharedStringCellText(ledgerDocument, sharedValues, "C10")).toBe("[교통비] 교통비 7_택시 1회");
    expect(sharedValues).not.toContain("비공개 결제자");
    expect(sharedValues).not.toContain("비공개 계좌");

    const templateSubtotalRows = [10, 14, 23, 28, 33, 39, 41, 46];
    const outputSubtotalRows = [12, 13, 14, 15, 16, 18, 19, 20];
    expect(outputSubtotalRows.map((row) => sharedStringCellText(ledgerDocument, sharedValues, `B${row}`)))
      .toEqual(templateSubtotalRows.map((row) => sharedStringCellText(originalLedgerDocument, sharedValues, `B${row}`)));

    // 교통비 7건은 5~11행만 사용하고 12행에서 합산한다.
    expect(ledgerDocument.querySelector('c[r="D12"] f')?.textContent).toBe("SUM(D5:D11)");
    expect(ledgerDocument.querySelector('mergeCell[ref="A5:A12"]')).not.toBeNull();
    // 지출이 없는 항목은 빈 거래행을 만들지 않고 합계행 하나만 둔다.
    for (const row of [13, 14, 15, 16, 19, 20]) {
      expect(ledgerDocument.querySelector(`c[r="D${row}"] f`)).toBeNull();
      expect(ledgerDocument.querySelector(`c[r="D${row}"] v`)?.textContent).toBe("0");
      expect(ledgerDocument.querySelector(`row[r="${row}"]`)?.getAttribute("ht")).toBe("16.5");
    }
    // 팀별사역비 1건은 거래행 17행과 합계행 18행으로 정확히 구성한다.
    expect(ledgerDocument.querySelector('c[r="D18"] f')?.textContent).toBe("SUM(D17:D17)");
    expect(ledgerDocument.querySelector('mergeCell[ref="A17:A18"]')).not.toBeNull();
    expect(ledgerDocument.querySelector('mergeCell[ref="F17:F19"]')).toBeNull();
    expect(Number(ledgerDocument.querySelector('row[r="17"]')?.getAttribute("ht"))).toBeGreaterThan(16.5);
    // 오른쪽 샘플은 50행까지 남아도 제출용 A:F는 각주 24행에서 끝난다.
    const leftReferences = [...ledgerDocument.querySelectorAll("sheetData c")]
      .map((cell) => cell.getAttribute("r") ?? "")
      .filter((reference) => /^[A-F]\d+$/.test(reference));
    expect(Math.max(...leftReferences.map((reference) => Number(reference.match(/\d+$/)?.[0])))).toBe(24);
    expect(ledgerDocument.querySelector('mergeCell[ref="H5:H10"]')).not.toBeNull();
    expect(ledgerDocument.querySelector("dimension")?.getAttribute("ref")).toBe("A1:N50");

    let sharedReferenceCount = 0;
    for (const worksheetFile of outputZip.file(/xl\/worksheets\/sheet\d+\.xml/)) {
      const worksheet = new DOMParser().parseFromString(
        await worksheetFile.async("string"),
        "application/xml",
      );
      for (const cell of worksheet.querySelectorAll('c[t="s"]')) {
        sharedReferenceCount += 1;
        const index = Number(cell.querySelector("v")?.textContent);
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(sharedValues.length);
      }
      expect(worksheet.querySelector('c[t="inlineStr"]')).toBeNull();
    }
    expect(Number(sharedStrings.documentElement.getAttribute("uniqueCount"))).toBe(sharedValues.length);
    expect(Number(sharedStrings.documentElement.getAttribute("count"))).toBe(sharedReferenceCount);

    const report = new DOMParser().parseFromString(await outputZip.file("xl/worksheets/sheet2.xml")!.async("string"), "application/xml");
    expect(report.querySelector('c[r="E25"] v')?.textContent).toBe("0");
    expect(report.querySelector('c[r="B6"]')?.children).toHaveLength(0);
    expect(sharedStringCellText(report, sharedValues, "C6")).toBe("그룹명 : ");

    const summary = new DOMParser().parseFromString(
      await outputZip.file("xl/worksheets/sheet1.xml")!.async("string"),
      "application/xml",
    );
    expect(summary.querySelector('c[r="G6"] f')?.getAttribute("t")).toBe("shared");
    expect(summary.querySelector('c[r="G6"] f')?.getAttribute("ref")).toBe("G6:G25");
    expect(summary.querySelector('c[r="G7"] f')?.getAttribute("si")).toBe("0");
    expect(summary.querySelector('c[r="D26"] f')?.getAttribute("ref")).toBe("D26:P26");
    expect(summary.querySelector('c[r="E26"] f')?.getAttribute("si")).toBe("3");

    const workbook = await outputZip.file("xl/workbook.xml")!.async("string");
    expect(workbook).toContain("'국내-금전출납부'!$A$1:$F$24");
    expect([...outputZip.file(/xl\/worksheets\/sheet\d+\.xml/)]).toHaveLength(6);

    const afterBytes = await readFile(templatePath);
    const afterHash = createHash("sha256").update(afterBytes).digest("hex");
    expect(afterHash).toBe(beforeHash);
  });

  it("모든 항목의 거래행을 항목별 영수증 건수와 정확히 일치시킨다", async () => {
    const originalBytes = await readFile(templatePath);
    vi.stubGlobal("fetch", async () => new Response(originalBytes));

    const project = createEmptyProject();
    const counts = [0, 1, 2, 3, 4, 5, 6, 7];
    let expenseIndex = 1;
    project.expenses = CATEGORY_DEFINITIONS.flatMap((definition, categoryIndex) =>
      Array.from({ length: counts[categoryIndex] }, (_, receiptIndex) => ({
        ...makeExpense(expenseIndex++),
        category: definition.id,
        date: `2026-07-${String(receiptIndex + 1).padStart(2, "0")}`,
        receiptNumber: receiptIndex + 1,
      })),
    );

    const outputZip = await JSZip.loadAsync(await createAccountingWorkbook(project));
    const ledger = new DOMParser().parseFromString(
      await outputZip.file("xl/worksheets/sheet3.xml")!.async("string"),
      "application/xml",
    );

    let cursor = 5;
    CATEGORY_DEFINITIONS.forEach((_, categoryIndex) => {
      const count = counts[categoryIndex];
      const start = cursor;
      const total = start + count;
      const totalCell = ledger.querySelector(`c[r="D${total}"]`);

      if (count === 0) {
        expect(totalCell?.querySelector("f")).toBeNull();
        expect(totalCell?.querySelector("v")?.textContent).toBe("0");
        expect(ledger.querySelector(`mergeCell[ref="A${start}:A${total}"]`)).toBeNull();
      } else {
        expect(totalCell?.querySelector("f")?.textContent).toBe(`SUM(D${start}:D${total - 1})`);
        expect(ledger.querySelector(`mergeCell[ref="A${start}:A${total}"]`)).not.toBeNull();
      }
      expect(ledger.querySelector(`mergeCell[ref="B${total}:C${total}"]`)).not.toBeNull();
      cursor = total + 1;
    });

    const expectedFooterEnd = cursor + 3;
    const leftReferences = [...ledger.querySelectorAll("sheetData c")]
      .map((cell) => cell.getAttribute("r") ?? "")
      .filter((reference) => /^[A-F]\d+$/.test(reference));
    expect(Math.max(...leftReferences.map((reference) => Number(reference.match(/\d+$/)?.[0])))).toBe(expectedFooterEnd);

    const workbook = await outputZip.file("xl/workbook.xml")!.async("string");
    expect(workbook).toContain(`'국내-금전출납부'!$A$1:$F$${expectedFooterEnd}`);
  });

  it("세부내역과 비고의 실제 줄 수 중 큰 값으로 거래행 높이를 정한다", async () => {
    const originalBytes = await readFile(templatePath);
    vi.stubGlobal("fetch", async () => new Response(originalBytes));

    const project = createEmptyProject();
    project.expenses = [
      {
        ...makeExpense(1),
        content: "짧은 내용",
        note: "비고내용".repeat(30),
      },
      {
        ...makeExpense(2),
        content: "긴 세부내역",
        itemDetails: "세부내역".repeat(30),
        note: "",
      },
      {
        ...makeExpense(3),
        content: "짧은 내용",
        itemDetails: "",
        note: "짧은 비고",
      },
    ];

    const outputBytes = await createAccountingWorkbook(project);
    const verificationDirectory = path.resolve(process.cwd(), "artifacts/verification");
    await mkdir(verificationDirectory, { recursive: true });
    await writeFile(path.join(verificationDirectory, "accounting-row-height-output.xlsx"), outputBytes);
    const outputZip = await JSZip.loadAsync(outputBytes);
    const ledger = new DOMParser().parseFromString(
      await outputZip.file("xl/worksheets/sheet3.xml")!.async("string"),
      "application/xml",
    );

    const noteDrivenHeight = Number(ledger.querySelector('row[r="5"]')?.getAttribute("ht"));
    const contentDrivenHeight = Number(ledger.querySelector('row[r="6"]')?.getAttribute("ht"));
    const singleLineHeight = Number(ledger.querySelector('row[r="7"]')?.getAttribute("ht"));
    expect(noteDrivenHeight).toBeGreaterThan(contentDrivenHeight);
    expect(contentDrivenHeight).toBeGreaterThan(singleLineHeight);
    expect(noteDrivenHeight).toBeGreaterThanOrEqual(300);
    expect(contentDrivenHeight).toBeGreaterThanOrEqual(50);
    expect(singleLineHeight).toBe(16.5);
  });
});
