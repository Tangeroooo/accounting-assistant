import { describe, expect, it } from "vitest";
import { applyDerivedState, settlementSummaries, sortAndNumberExpenses, validateProject } from "./accounting";
import { createEmptyProject, type Expense } from "../types";

const expense = (partial: Partial<Expense>): Expense => ({
  id: crypto.randomUUID(),
  createdOrder: 1,
  category: "transport",
  date: "2026-07-01",
  content: "테스트 지출",
  amount: 10_000,
  note: "",
  receiptMode: "offline-original",
  originalConfirmed: true,
  attachments: [],
  itemDetails: "",
  isFuel: false,
  paymentSource: "team",
  settlementTargetAmount: 0,
  settledAmount: 0,
  settlementStatus: "not-applicable",
  ...partial,
});

describe("금전출납부 정렬과 번호", () => {
  it("항목 순서, 날짜 순서로 정렬하고 항목마다 번호를 다시 시작한다", () => {
    const result = sortAndNumberExpenses([
      expense({ id: "meal-late", category: "meals", date: "2026-07-03", createdOrder: 3 }),
      expense({ id: "transport-late", category: "transport", date: "2026-07-04", createdOrder: 4 }),
      expense({ id: "meal-early", category: "meals", date: "2026-07-01", createdOrder: 2 }),
      expense({ id: "transport-early", category: "transport", date: "2026-07-01", createdOrder: 1 }),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      "transport-early",
      "transport-late",
      "meal-early",
      "meal-late",
    ]);
    expect(result.map((item) => item.receiptNumber)).toEqual([1, 2, 1, 2]);
  });

  it("같은 날짜에는 등록 순서를 유지한다", () => {
    const result = sortAndNumberExpenses([
      expense({ id: "second", createdOrder: 20 }),
      expense({ id: "first", createdOrder: 10 }),
    ]);
    expect(result.map((item) => item.id)).toEqual(["first", "second"]);
  });
});
describe("교육자료 기반 검산", () => {
  it("주유비가 있으면 개별 짝이 아닌 교통비 공통 증빙 1건을 요구한다", () => {
    const project = createEmptyProject();
    project.expenses = [expense({ isFuel: true })];
    expect(validateProject(project).some((issue) => issue.id === "missing-shared-fuel-evidence")).toBe(true);

    project.categoryEvidence = [{
      id: "shared-fuel",
      category: "transport",
      kind: "fuel-calculation",
      title: "공통 산정표",
      attachments: [{ id: "file", relativePath: "attachments/fuel.png", originalName: "fuel.png", mimeType: "image/png", kind: "other" }],
    }];
    expect(validateProject(project).some((issue) => issue.id === "missing-shared-fuel-evidence")).toBe(false);
  });

  it("개인 선결제는 사람별로 합산하고 공식 지출금액과 동일하게 검산한다", () => {
    const project = createEmptyProject();
    project.people = [{ id: "payer", name: "김회계", bankMemo: "" }];
    project.expenses = [
      expense({ paymentSource: "personal", payerId: "payer", amount: 40_000, settlementTargetAmount: 40_000 }),
      expense({ paymentSource: "personal", payerId: "payer", amount: 60_000, settlementTargetAmount: 60_000, settledAmount: 20_000 }),
    ];
    const [summary] = settlementSummaries(applyDerivedState(project));
    expect(summary).toMatchObject({ paidPersonally: 100_000, targetAmount: 100_000, settledAmount: 20_000, outstandingAmount: 80_000 });
  });
});
