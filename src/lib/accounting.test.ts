import { describe, expect, it } from "vitest";
import { applyDerivedState, assignPayerFromExpense, expenseContentForEditor, expenseForSaveFromEditor, incomeTotals, reconciliationSummary, settlementSummaries, sortAndNumberExpenses, summarizeValidationIssues, teamMinistryAutoNote, validateProject } from "./accounting";
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
  it("예전 내용과 세부 품목을 단일 내용 입력값으로 합친다", () => {
    expect(expenseContentForEditor(expense({
      content: "첫날 저녁 식사",
      itemDetails: "돈까스*12개/김밥*24줄",
    }))).toBe("첫날 저녁 식사_돈까스*12개/김밥*24줄");
    expect(expenseContentForEditor(expense({
      content: "렌터카 주유비",
      itemDetails: "",
    }))).toBe("렌터카 주유비");
  });

  it("단일 내용을 수정할 때만 예전 세부 품목 필드를 비운다", () => {
    const original = expense({
      content: "첫날 저녁 식사",
      itemDetails: "돈까스*12개/김밥*24줄",
    });
    const draft = {
      ...original,
      content: "첫날 저녁 식사_돈까스*12개/김밥*24줄",
      itemDetails: "",
      amount: 25_000,
    };

    expect(expenseForSaveFromEditor(original, draft, false)).toMatchObject({
      content: "첫날 저녁 식사",
      itemDetails: "돈까스*12개/김밥*24줄",
      amount: 25_000,
    });
    expect(expenseForSaveFromEditor(original, {
      ...draft,
      content: "둘째 날 저녁_비빔밥*12개",
    }, true)).toMatchObject({
      content: "둘째 날 저녁_비빔밥*12개",
      itemDetails: "",
    });
  });

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
  it("회비 단가와 인원수를 곱하고 지출 입력값을 포함해 차액을 즉시 검산한다", () => {
    const project = createEmptyProject();
    project.meta.headcount = 5;
    project.duesPerPerson = 20_000;
    project.incomes = [{ id: "support", type: "teamSupport", amount: 50_000, receivedAt: "", memo: "" }];
    project.expenses = [expense({ amount: 80_000 })];

    expect(incomeTotals(project)).toMatchObject({ dues: 100_000, teamSupport: 50_000, total: 150_000 });
    expect(reconciliationSummary(project)).toMatchObject({ returnAmount: 50_000, difference: 20_000 });
  });

  it("6. 팀별사역비 지출만 지원금 사용액으로 합산하고 남은 금액을 환입한다", () => {
    const project = createEmptyProject();
    project.meta.headcount = 1;
    project.duesPerPerson = 20_000;
    project.incomes = [{ id: "support", type: "teamSupport", amount: 100_000, receivedAt: "", memo: "" }];
    project.expenses = [
      expense({ id: "supported", category: "teamMinistry", amount: 60_000 }),
      expense({ id: "ordinary", category: "ministry", amount: 20_000 }),
    ];

    expect(reconciliationSummary(project)).toMatchObject({
      teamMinistryAmount: 60_000,
      returnAmount: 40_000,
      difference: 0,
    });
  });

  it("팀별사역비가 지원금을 넘으면 환입액을 0원으로 두고 초과 경고를 만들지 않는다", () => {
    const project = createEmptyProject();
    project.incomes = [{ id: "support", type: "teamSupport", amount: 50_000, receivedAt: "", memo: "" }];
    project.expenses = [expense({ category: "teamMinistry", amount: 70_000 })];

    expect(reconciliationSummary(project).returnAmount).toBe(0);
    expect(validateProject(project).some((issue) => issue.id === "team-ministry-over-support")).toBe(false);
  });

  it("팀별사역비 첫 행에 지원금과 회비 충당액을 원본 예시 형식으로 자동 작성한다", () => {
    const project = createEmptyProject();
    project.incomes = [{ id: "support", type: "teamSupport", amount: 300_000, receivedAt: "", memo: "" }];
    project.expenses = [expense({ id: "team", category: "teamMinistry", amount: 305_850 })];

    expect(teamMinistryAutoNote(project)).toBe("팀별사역지원금 300.000원\n팀회비\n5.850원 사용");
    expect(applyDerivedState(project).expenses[0]).toMatchObject({
      note: "팀별사역지원금 300.000원\n팀회비\n5.850원 사용",
      noteMode: "auto",
    });

    project.expenses[0].note = "담당자 확인 완료";
    project.expenses[0].noteMode = "manual";
    expect(applyDerivedState(project).expenses[0].note).toBe("담당자 확인 완료");
  });

  it("날짜나 항목 변경으로 첫 팀별사역비가 바뀌면 자동 비고도 첫 행으로 옮긴다", () => {
    const project = createEmptyProject();
    project.incomes = [{ id: "support", type: "teamSupport", amount: 30_000, receivedAt: "", memo: "" }];
    project.expenses = [expense({ id: "later", category: "teamMinistry", date: "2026-07-10", amount: 20_000 })];
    project.expenses = applyDerivedState(project).expenses;
    project.expenses.push(expense({ id: "earlier", category: "teamMinistry", date: "2026-07-01", amount: 20_000, createdOrder: 2 }));

    const result = applyDerivedState(project);
    expect(result.expenses.find((item) => item.id === "earlier")).toMatchObject({ noteMode: "auto" });
    expect(result.expenses.find((item) => item.id === "later")).toMatchObject({ note: "", noteMode: undefined });
  });

  it("잘못된 마킹 방식으로 저장된 임시 프로젝트는 6. 팀별사역비로 옮긴다", () => {
    const project = createEmptyProject();
    project.expenses = [{
      ...expense({ category: "ministry" }),
      teamSupportApplied: true,
    } as Expense];

    const [migrated] = applyDerivedState(project).expenses;
    expect(migrated.category).toBe("teamMinistry");
    expect("teamSupportApplied" in migrated).toBe(false);
  });

  it("지출 입력 중 새 결제자 이름을 바로 등록하고 같은 이름은 재사용한다", () => {
    const first = assignPayerFromExpense([], expense({ paymentSource: "personal", amount: 25_000 }), " 김회계 ");
    expect(first.people).toHaveLength(1);
    expect(first.people[0].name).toBe("김회계");
    expect(first.expense).toMatchObject({ payerId: first.people[0].id, settlementTargetAmount: 25_000 });

    const second = assignPayerFromExpense(first.people, expense({ paymentSource: "personal" }), "김회계");
    expect(second.people).toHaveLength(1);
    expect(second.expense.payerId).toBe(first.people[0].id);
  });

  it("주유비가 있으면 개별 짝이 아닌 교통비 공통 증빙을 하나 이상 요구한다", () => {
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

    project.categoryEvidence[0].attachments = [];
    project.categoryEvidence[0].offlineHolders = [{ id: "offline-fuel", widthMm: 82, heightMm: 62 }];
    expect(validateProject(project).some((issue) => issue.id === "missing-shared-fuel-evidence")).toBe(false);
  });

  it("주유비는 공통 산정 증빙과 별도로 실물 영수증 원본을 요구한다", () => {
    const project = createEmptyProject();
    project.expenses = [expense({ isFuel: true, receiptMode: "online-printable" })];
    expect(validateProject(project).some((issue) => issue.id.endsWith("-fuel-original"))).toBe(true);
  });

  it("보험증권 누락은 저장을 막는 오류가 아니라 확인용 주의로 표시한다", () => {
    const project = createEmptyProject();
    project.expenses = [expense({
      id: "insurance",
      category: "misc",
      content: "단체보험료_총27명",
      receiptMode: "online-printable",
      attachments: [{
        id: "insurance-payment",
        relativePath: "attachments/insurance-payment.png",
        originalName: "보험료 결제내역.png",
        mimeType: "image/png",
        kind: "transfer-proof",
      }],
    })];

    const insuranceIssue = validateProject(project)
      .find((issue) => issue.id === "expense-insurance-insurance-certificate");
    expect(insuranceIssue).toMatchObject({
      severity: "warning",
      title: "보험증권이 필요합니다",
    });

    project.expenses[0].attachments.push({
      id: "insurance-certificate",
      relativePath: "attachments/insurance-certificate.png",
      originalName: "보험가입증명서.png",
      mimeType: "image/png",
      kind: "insurance-certificate",
    });
    expect(validateProject(project).some((issue) => issue.id === "expense-insurance-insurance-certificate")).toBe(false);
  });

  it("여러 영수증에서 반복되는 같은 검토 규칙을 한 항목과 대상 건수로 요약한다", () => {
    const project = createEmptyProject();
    project.expenses = [
      expense({
        id: "online-1",
        createdOrder: 1,
        receiptMode: "online-printable",
        attachments: [{ id: "receipt-1", relativePath: "attachments/1.png", originalName: "1.png", mimeType: "image/png", kind: "online-receipt" }],
      }),
      expense({
        id: "online-2",
        createdOrder: 2,
        receiptMode: "online-printable",
        attachments: [{ id: "receipt-2", relativePath: "attachments/2.png", originalName: "2.png", mimeType: "image/png", kind: "online-receipt" }],
      }),
    ];

    const summaries = summarizeValidationIssues(project, validateProject(project));
    const onlineDetail = summaries.find((issue) => issue.title === "온라인 거래 상세내역을 확인해 주세요");
    expect(onlineDetail).toMatchObject({
      count: 2,
      expenseIds: ["online-1", "online-2"],
      targetSummary: "대상 2건 · 교통비 1번, 교통비 2번",
    });
  });

  it("팀별사역비의 교역자 선물과 국내 30만원 초과 헌금을 안내한다", () => {
    const project = createEmptyProject();
    project.expenses = [
      expense({ id: "gift", category: "teamMinistry", content: "목사님 선물" }),
      expense({ id: "offering", category: "offering", amount: 310_000 }),
    ];
    const issues = validateProject(project);
    expect(issues.some((issue) => issue.id === "expense-gift-team-ministry-gift")).toBe(true);
    expect(issues.some((issue) => issue.id === "offering-over-domestic-guideline")).toBe(true);
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
