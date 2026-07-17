import {
  CATEGORY_DEFINITIONS,
  type CategoryId,
  type Expense,
  type ProjectData,
  type SettlementSummary,
  type ValidationIssue,
} from "../types";

const categoryOrder = new Map<CategoryId, number>(
  CATEGORY_DEFINITIONS.map((category, index) => [category.id, index]),
);

export function sortAndNumberExpenses(expenses: Expense[]): Expense[] {
  const sorted = expenses
    .map((expense) => ({ ...expense }))
    .sort((left, right) => {
      const categoryDifference =
        (categoryOrder.get(left.category) ?? 99) - (categoryOrder.get(right.category) ?? 99);
      if (categoryDifference !== 0) return categoryDifference;
      const dateDifference = left.date.localeCompare(right.date);
      if (dateDifference !== 0) return dateDifference;
      return left.createdOrder - right.createdOrder;
    });

  const nextNumber = new Map<CategoryId, number>();
  return sorted.map((expense) => {
    const receiptNumber = nextNumber.get(expense.category) ?? 1;
    nextNumber.set(expense.category, receiptNumber + 1);
    return { ...expense, receiptNumber };
  });
}

export function expenseTotals(expenses: Expense[]) {
  const byCategory = Object.fromEntries(
    CATEGORY_DEFINITIONS.map((category) => [category.id, 0]),
  ) as Record<CategoryId, number>;

  for (const expense of expenses) byCategory[expense.category] += expense.amount;
  const total = Object.values(byCategory).reduce((sum, amount) => sum + amount, 0);
  return { byCategory, total };
}

export function incomeTotals(project: ProjectData) {
  const dues = project.incomes
    .filter((income) => income.type === "dues")
    .reduce((sum, income) => sum + income.amount, 0);
  const teamSupport = project.incomes
    .filter((income) => income.type === "teamSupport")
    .reduce((sum, income) => sum + income.amount, 0);
  const flowing = project.incomes
    .filter((income) => income.type === "flowing")
    .reduce((sum, income) => sum + income.amount, 0);
  return { dues, teamSupport, flowing, total: dues + teamSupport + flowing };
}

export function settlementSummaries(project: ProjectData): SettlementSummary[] {
  return project.people
    .map((person) => {
      const personalExpenses = project.expenses.filter(
        (expense) => expense.paymentSource === "personal" && expense.payerId === person.id,
      );
      const paidPersonally = personalExpenses.reduce((sum, expense) => sum + expense.amount, 0);
      const targetAmount = personalExpenses.reduce(
        (sum, expense) => sum + expense.settlementTargetAmount,
        0,
      );
      const settledAmount = personalExpenses.reduce(
        (sum, expense) => sum + expense.settledAmount,
        0,
      );
      return {
        personId: person.id,
        personName: person.name,
        expenseCount: personalExpenses.length,
        paidPersonally,
        targetAmount,
        settledAmount,
        outstandingAmount: targetAmount - settledAmount,
      };
    })
    .filter((summary) => summary.expenseCount > 0)
    .sort((left, right) => right.outstandingAmount - left.outstandingAmount);
}

const hasAttachment = (expense: Expense, kinds: Expense["attachments"][number]["kind"][]) =>
  expense.attachments.some((attachment) => kinds.includes(attachment.kind));

export function validateProject(project: ProjectData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const expenses = sortAndNumberExpenses(project.expenses);
  const income = incomeTotals(project);
  const expense = expenseTotals(expenses);
  const teamMinistrySpent = expense.byCategory.teamMinistry;
  const returnAmount = Math.max(income.teamSupport - teamMinistrySpent, 0);
  const reconciledDifference = income.total - expense.total - returnAmount;

  if (reconciledDifference !== 0) {
    issues.push({
      id: "income-expense-mismatch",
      severity: "error",
      scope: "project",
      title: "수입·지출이 일치하지 않습니다",
      detail: `총수입 - 총지출 - 환입액 차이가 ${reconciledDifference.toLocaleString("ko-KR")}원입니다.`,
    });
  }

  const hasFuel = expenses.some((item) => item.category === "transport" && item.isFuel);
  const hasFuelEvidence = project.categoryEvidence.some(
    (evidence) =>
      evidence.category === "transport" &&
      evidence.kind === "fuel-calculation" &&
      evidence.attachments.length > 0,
  );
  if (hasFuel && !hasFuelEvidence) {
    issues.push({
      id: "missing-shared-fuel-evidence",
      severity: "error",
      scope: "evidence",
      title: "교통비 공통 주유비 증빙이 없습니다",
      detail: "주유비 지출이 있으므로 네이버 지도 거리·유류비 산정 증빙 1건을 등록해 주세요.",
    });
  }

  for (const item of expenses) {
    const prefix = `expense-${item.id}`;
    if (!item.date || !item.content.trim() || item.amount <= 0) {
      issues.push({
        id: `${prefix}-required`,
        severity: "error",
        scope: "expense",
        expenseId: item.id,
        title: "필수 지출 정보가 비어 있습니다",
        detail: "날짜, 내용, 0원보다 큰 금액이 모두 필요합니다.",
      });
    }
    if (item.receiptMode === "offline-original" && !item.originalConfirmed) {
      issues.push({
        id: `${prefix}-original`,
        severity: "error",
        scope: "evidence",
        expenseId: item.id,
        title: "실물 영수증 보유 확인이 필요합니다",
        detail: "오프라인 영수증은 최종 출력 전에 원본 보유 여부를 확인해야 합니다.",
      });
    }
    if (item.receiptMode === "online-printable" && item.attachments.length === 0) {
      issues.push({
        id: `${prefix}-online-file`,
        severity: "error",
        scope: "evidence",
        expenseId: item.id,
        title: "온라인 영수증 파일이 없습니다",
        detail: "영수증철에 인쇄할 이미지 또는 PDF를 등록해 주세요.",
      });
    }
    if (item.category === "meals" && !item.mealHeadcount) {
      issues.push({
        id: `${prefix}-headcount`,
        severity: "warning",
        scope: "expense",
        expenseId: item.id,
        title: "식사 인원이 입력되지 않았습니다",
        detail: "식대간식비는 먹은 인원을 내용에 포함해야 합니다.",
      });
    }
    if (item.paymentSource === "personal" && !item.payerId) {
      issues.push({
        id: `${prefix}-payer`,
        severity: "error",
        scope: "settlement",
        expenseId: item.id,
        title: "선결제자가 지정되지 않았습니다",
        detail: "개인 선결제는 정산받을 사람을 앱 내부 정보로 지정해야 합니다.",
      });
    }
    if (item.settledAmount > item.settlementTargetAmount) {
      issues.push({
        id: `${prefix}-over-settled`,
        severity: "error",
        scope: "settlement",
        expenseId: item.id,
        title: "정산 완료액이 정산 대상액보다 큽니다",
        detail: "정산 금액을 다시 확인해 주세요.",
      });
    }
    const isOnlineStore = item.receiptMode === "online-printable";
    if (
      isOnlineStore &&
      !hasAttachment(item, ["transaction-statement", "order-detail", "tax-invoice"])
    ) {
      issues.push({
        id: `${prefix}-transaction-statement`,
        severity: "warning",
        scope: "evidence",
        expenseId: item.id,
        title: "온라인 거래 상세내역을 확인해 주세요",
        detail: "카드전표만으로 품목이 확인되지 않으면 거래명세서 또는 주문상세정보가 필요합니다.",
      });
    }
  }

  return issues;
}

export function applyDerivedState(project: ProjectData): ProjectData {
  const expenses = sortAndNumberExpenses(project.expenses).map((expense) => {
    if (expense.paymentSource === "team") {
      return {
        ...expense,
        payerId: undefined,
        settlementTargetAmount: 0,
        settledAmount: 0,
        settlementStatus: "not-applicable" as const,
      };
    }
    const target = expense.settlementTargetAmount || expense.amount;
    const status: Expense["settlementStatus"] =
      expense.settledAmount <= 0
        ? "pending"
        : expense.settledAmount >= target
          ? "settled"
          : "partial";
    return { ...expense, settlementTargetAmount: target, settlementStatus: status };
  });
  return { ...project, expenses, updatedAt: new Date().toISOString() };
}
