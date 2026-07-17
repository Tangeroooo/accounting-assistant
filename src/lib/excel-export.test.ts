// @vitest-environment jsdom
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountingWorkbook } from "./excel-export";
import { applyDerivedState } from "./accounting";
import { createEmptyProject, type Expense } from "../types";

const templatePath = path.resolve(process.cwd(), "resources/accounting-template.xlsx");

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
  it("원본은 그대로 두고 금전출납부 부족 행만 늘리며 나머지 샘플 시트를 보존한다", async () => {
    const originalBytes = await readFile(templatePath);
    const beforeHash = createHash("sha256").update(originalBytes).digest("hex");
    vi.stubGlobal("fetch", async () => new Response(originalBytes));

    const project = createEmptyProject();
    project.meta.community = "테스트";
    project.meta.teamName = "강릉팀";
    project.people = [{ id: "payer-secret", name: "비공개 결제자", bankMemo: "비공개 계좌" }];
    project.expenses = Array.from({ length: 7 }, (_, index) => makeExpense(index + 1));
    project.incomes = [{ id: "income", type: "dues", amount: 280_000, receivedAt: "2026-07-01", memo: "" }];

    const outputBytes = await createAccountingWorkbook(applyDerivedState(project));
    const verificationDirectory = path.resolve(process.cwd(), "artifacts/verification");
    await mkdir(verificationDirectory, { recursive: true });
    await writeFile(path.join(verificationDirectory, "accounting-output.xlsx"), outputBytes);
    const originalZip = await JSZip.loadAsync(originalBytes);
    const outputZip = await JSZip.loadAsync(outputBytes);

    for (const path of ["xl/worksheets/sheet4.xml", "xl/worksheets/sheet5.xml", "xl/worksheets/sheet6.xml", "xl/styles.xml", "xl/sharedStrings.xml"]) {
      expect(await outputZip.file(path)?.async("uint8array")).toEqual(await originalZip.file(path)?.async("uint8array"));
    }

    const ledger = await outputZip.file("xl/worksheets/sheet3.xml")!.async("string");
    expect(ledger).toContain("교통비 7");
    expect(ledger).toContain("SUM(D5:D11)");
    expect(ledger).not.toContain("비공개 결제자");
    expect(ledger).not.toContain("비공개 계좌");

    const workbook = await outputZip.file("xl/workbook.xml")!.async("string");
    expect(workbook).toContain("'국내-금전출납부'!$A$1:$F$52");
    expect([...outputZip.file(/xl\/worksheets\/sheet\d+\.xml/)]).toHaveLength(6);

    const afterBytes = await readFile(templatePath);
    const afterHash = createHash("sha256").update(afterBytes).digest("hex");
    expect(afterHash).toBe(beforeHash);
  });
});
