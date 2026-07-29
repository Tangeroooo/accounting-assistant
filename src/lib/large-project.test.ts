// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CATEGORY_DEFINITIONS, createEmptyProject, type Expense } from "../types";
import { applyDerivedState, validateProject } from "./accounting";
import { createAccountingWorkbook } from "./excel-export";
import { buildReceiptBookItems, layoutReceiptBookItems } from "./receipt-book";

const templatePath = path.resolve(process.cwd(), "resources/accounting-template.xlsx");

const largeExpense = (index: number): Expense => ({
  id: `large-expense-${index}`,
  createdOrder: index,
  category: CATEGORY_DEFINITIONS[index % CATEGORY_DEFINITIONS.length].id,
  date: `2026-07-${String(index % 28 + 1).padStart(2, "0")}`,
  content: `100건 성능 검증 지출 ${index + 1}_품목 1개`,
  amount: 10_000 + index,
  note: index % 10 === 0 ? "비고 검증" : "",
  receiptMode: "offline-original",
  originalConfirmed: true,
  attachments: [],
  offlineHolders: [{ id: `holder-${index}`, widthMm: 82, heightMm: 62 }],
  itemDetails: "",
  isFuel: false,
  paymentSource: "team",
  settlementTargetAmount: 0,
  settledAmount: 0,
  settlementStatus: "not-applicable",
});

afterEach(() => vi.unstubAllGlobals());

describe("100건 프로젝트 성능·구조 회귀", () => {
  it("정렬·검토·영수증 배치와 Excel 생성을 실사용 가능한 시간 안에 마친다", async () => {
    const templateBytes = await readFile(templatePath);
    vi.stubGlobal("fetch", async () => new Response(templateBytes));

    const project = createEmptyProject();
    project.expenses = Array.from({ length: 100 }, (_, index) => largeExpense(index));

    const coreStartedAt = performance.now();
    const normalized = applyDerivedState(project);
    const issues = validateProject(normalized);
    const receiptItems = buildReceiptBookItems(normalized);
    const receiptPages = layoutReceiptBookItems(receiptItems);
    const coreElapsedMs = performance.now() - coreStartedAt;

    const excelStartedAt = performance.now();
    const workbookBytes = await createAccountingWorkbook(normalized);
    const excelElapsedMs = performance.now() - excelStartedAt;
    const workbook = await JSZip.loadAsync(workbookBytes);
    const workbookXml = await workbook.file("xl/workbook.xml")!.async("string");

    expect(normalized.expenses).toHaveLength(100);
    expect(issues.length).toBeGreaterThan(0);
    expect(receiptItems).toHaveLength(100);
    expect(receiptPages.length).toBeGreaterThan(1);
    expect(workbookXml).toContain("'국내-금전출납부'!$A$1:$F$116");
    expect(coreElapsedMs).toBeLessThan(1_000);
    expect(excelElapsedMs).toBeLessThan(10_000);

    // 로컬·CI 결과에서 성능 퇴행 원인을 바로 파악할 수 있도록 실제 측정값을 남긴다.
    console.info(JSON.stringify({
      expenses: 100,
      coreElapsedMs: Math.round(coreElapsedMs),
      excelElapsedMs: Math.round(excelElapsedMs),
      receiptPages: receiptPages.length,
      workbookBytes: workbookBytes.byteLength,
    }));
  }, 15_000);
});
