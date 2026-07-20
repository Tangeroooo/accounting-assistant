import {
  CATEGORY_DEFINITIONS,
  getCategory,
  type CategoryId,
  type Expense,
  type Person,
  type ProjectData,
  type SettlementSummary,
  type ValidationIssue,
} from "../types";

export function assignPayerFromExpense(people: Person[], expense: Expense, payerName?: string) {
  const normalizedName = payerName?.trim();
  if (expense.paymentSource !== "personal" || !normalizedName) return { people, expense };
  const existing = people.find(
    (person) => person.name.trim().toLocaleLowerCase("ko-KR") === normalizedName.toLocaleLowerCase("ko-KR"),
  );
  const payerId = existing?.id ?? crypto.randomUUID();
  return {
    people: existing ? people : [...people, { id: payerId, name: normalizedName, bankMemo: "" }],
    expense: {
      ...expense,
      payerId,
      settlementTargetAmount: expense.settlementTargetAmount || expense.amount,
    },
  };
}

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

export function teamMinistryExpenseTotal(expenses: Expense[]) {
  return expenses
    .filter((expense) => expense.category === "teamMinistry")
    .reduce((sum, expense) => sum + Math.max(0, expense.amount), 0);
}

export function incomeTotals(project: ProjectData) {
  const storedDues = project.incomes
    .filter((income) => income.type === "dues")
    .reduce((sum, income) => sum + income.amount, 0);
  const dues = Number.isFinite(project.duesPerPerson)
    ? Math.max(0, project.duesPerPerson) * Math.max(0, project.meta.headcount)
    : storedDues;
  const teamSupport = project.incomes
    .filter((income) => income.type === "teamSupport")
    .reduce((sum, income) => sum + income.amount, 0);
  const flowing = project.incomes
    .filter((income) => income.type === "flowing")
    .reduce((sum, income) => sum + income.amount, 0);
  return { dues, teamSupport, flowing, total: dues + teamSupport + flowing };
}

export function reconciliationSummary(project: ProjectData) {
  const income = incomeTotals(project);
  const expense = expenseTotals(project.expenses);
  const teamMinistryAmount = teamMinistryExpenseTotal(project.expenses);
  const returnAmount = Math.max(income.teamSupport - teamMinistryAmount, 0);
  const difference = income.total - expense.total - returnAmount;
  return { income, expense, teamMinistryAmount, returnAmount, difference };
}

const AUTO_TEAM_MINISTRY_NOTE = /^팀별사역지원금 [\d.,]+원(?:\n팀회비\n[\d.,]+원 사용)?$/;

const formatTemplateAmount = (amount: number) =>
  Math.max(0, Math.trunc(amount)).toLocaleString("ko-KR").replaceAll(",", ".");

export function isAutoTeamMinistryNote(note: string) {
  return AUTO_TEAM_MINISTRY_NOTE.test(note.trim());
}

export function teamMinistryAutoNote(project: ProjectData) {
  const { income, teamMinistryAmount } = reconciliationSummary(project);
  const duesUsed = Math.max(teamMinistryAmount - income.teamSupport, 0);
  const supportLine = `팀별사역지원금 ${formatTemplateAmount(income.teamSupport)}원`;
  return duesUsed > 0
    ? `${supportLine}\n팀회비\n${formatTemplateAmount(duesUsed)}원 사용`
    : supportLine;
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

export interface ValidationIssueSummary extends Omit<ValidationIssue, "id" | "expenseId"> {
  id: string;
  count: number;
  issueIds: string[];
  expenseIds: string[];
  targetSummary?: string;
}

/**
 * 같은 검토 규칙이 여러 영수증에서 반복될 때 화면에는 한 항목으로 묶는다.
 * 대상은 앞의 세 건만 보여 주고 나머지는 건수로 줄여 긴 경고 목록을 방지한다.
 */
export function summarizeValidationIssues(
  project: ProjectData,
  issues: ValidationIssue[],
): ValidationIssueSummary[] {
  const numberedExpenses = new Map(
    sortAndNumberExpenses(project.expenses).map((expense) => [expense.id, expense]),
  );
  const groups = new Map<string, ValidationIssueSummary>();

  for (const issue of issues) {
    const key = [issue.severity, issue.scope, issue.title, issue.detail].join("\u0000");
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.issueIds.push(issue.id);
      if (issue.expenseId && !existing.expenseIds.includes(issue.expenseId)) {
        existing.expenseIds.push(issue.expenseId);
      }
      continue;
    }
    groups.set(key, {
      id: issue.id,
      severity: issue.severity,
      scope: issue.scope,
      title: issue.title,
      detail: issue.detail,
      count: 1,
      issueIds: [issue.id],
      expenseIds: issue.expenseId ? [issue.expenseId] : [],
    });
  }

  return [...groups.values()].map((summary) => {
    if (summary.expenseIds.length === 0) return summary;
    const labels = summary.expenseIds.flatMap((expenseId) => {
      const expense = numberedExpenses.get(expenseId);
      if (!expense) return [];
      return [`${getCategory(expense.category).label} ${expense.receiptNumber ?? "?"}번`];
    });
    const visibleLabels = labels.slice(0, 3).join(", ");
    const remainingCount = Math.max(0, labels.length - 3);
    return {
      ...summary,
      targetSummary: `대상 ${labels.length}건 · ${visibleLabels}${remainingCount > 0 ? ` 외 ${remainingCount}건` : ""}`,
    };
  });
}

export function validateProject(project: ProjectData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const expenses = sortAndNumberExpenses(project.expenses);
  const reconciliation = reconciliationSummary({ ...project, expenses });
  const { difference: reconciledDifference } = reconciliation;

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
      (evidence.attachments.length > 0 || (evidence.offlineHolders?.length ?? 0) > 0),
  );
  if (hasFuel && !hasFuelEvidence) {
    issues.push({
      id: "missing-shared-fuel-evidence",
      severity: "error",
      scope: "evidence",
      title: "교통비 공통 주유비 증빙이 없습니다",
      detail: "주유비 지출이 있으므로 거리·유류비 산정 증빙을 하나 이상 등록해 주세요. 온라인 파일이나 인쇄 후 붙일 오프라인 부착칸을 여러 개 추가할 수 있습니다.",
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
    if (item.isFuel && item.receiptMode !== "offline-original") {
      issues.push({
        id: `${prefix}-fuel-original`,
        severity: "error",
        scope: "evidence",
        expenseId: item.id,
        title: "주유비는 실물 영수증 원본이 필요합니다",
        detail: "주유비 산정 증빙과 별도로 주유소에서 받은 실물 영수증 원본을 제출해야 합니다.",
      });
    }
    if (item.receiptMode === "online-printable" && item.attachments.length === 0) {
      issues.push({
        id: `${prefix}-online-file`,
        severity: "error",
        scope: "evidence",
        expenseId: item.id,
        title: "온라인 영수증 파일이 없습니다",
        detail: "영수증철 PDF에 넣을 이미지 또는 PDF를 등록해 주세요.",
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
    const description = `${item.content} ${item.itemDetails}`;
    if (
      item.category === "teamMinistry" &&
      /(목사|목회자|교역자|선교사)/.test(description) &&
      /선물/.test(description)
    ) {
      issues.push({
        id: `${prefix}-team-ministry-gift`,
        severity: "error",
        scope: "expense",
        expenseId: item.id,
        title: "교역자·선교사 선물은 선물구입비로 분류합니다",
        detail: "교육자료 기준에 따라 이 지출의 항목을 5. 선물구입비로 변경해 주세요.",
      });
    }
    if (/여행자\s*보험|단체\s*보험/.test(description)) {
      if (!hasAttachment(item, ["insurance-certificate"])) {
        issues.push({
          id: `${prefix}-insurance-certificate`,
          severity: "error",
          scope: "evidence",
          expenseId: item.id,
          title: "보험증권이 필요합니다",
          detail: "여행자·단체보험은 결제 증빙과 함께 보험증권을 첨부해 주세요.",
        });
      }
      if (
        item.receiptMode === "online-printable" &&
        !hasAttachment(item, ["online-receipt", "card-slip", "transfer-proof"])
      ) {
        issues.push({
          id: `${prefix}-insurance-payment`,
          severity: "error",
          scope: "evidence",
          expenseId: item.id,
          title: "보험료 결제 증빙이 필요합니다",
          detail: "카드전표 또는 이체확인증을 첨부해 주세요.",
        });
      }
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

  const domesticOffering = expenses
    .filter((item) => item.category === "offering")
    .reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  if (domesticOffering > 300_000) {
    issues.push({
      id: "offering-over-domestic-guideline",
      severity: "warning",
      scope: "project",
      title: "국내 헌금이 30만원을 초과합니다",
      detail: "교육자료의 국내 헌금 기준을 넘으므로 담당 교역자와 협의했는지 확인해 주세요.",
    });
  }

  return issues;
}

export function applyDerivedState(project: ProjectData): ProjectData {
  const existingDues = project.incomes
    .filter((income) => income.type === "dues")
    .reduce((sum, income) => sum + income.amount, 0);
  const duesPerPerson = Number.isFinite(project.duesPerPerson)
    ? Math.max(0, project.duesPerPerson)
    : project.meta.headcount > 0
      ? Math.round(existingDues / project.meta.headcount)
      : 0;
  const duesAmount = duesPerPerson * Math.max(0, project.meta.headcount);
  const firstDues = project.incomes.find((income) => income.type === "dues");
  const incomes = firstDues
    ? project.incomes
      .map((income) => income.id === firstDues.id ? { ...income, amount: duesAmount } : income)
      .filter((income, index, items) => income.type !== "dues" || items.findIndex((candidate) => candidate.type === "dues") === index)
    : duesAmount > 0
      ? [...project.incomes, { id: crypto.randomUUID(), type: "dues" as const, amount: duesAmount, receivedAt: "", memo: "팀 회비" }]
      : project.incomes;
  const migratedExpenses = project.expenses.map((expense) => {
    const legacy = expense as Expense & { teamSupportApplied?: boolean };
    const { teamSupportApplied, ...cleanExpense } = legacy;
    return teamSupportApplied === true
      ? { ...cleanExpense, category: "teamMinistry" as const }
      : cleanExpense;
  });
  let expenses = sortAndNumberExpenses(migratedExpenses).map((expense) => {
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
  const firstTeamMinistryId = expenses.find((expense) => expense.category === "teamMinistry")?.id;
  if (firstTeamMinistryId) {
    const automaticNote = teamMinistryAutoNote({ ...project, incomes, expenses });
    expenses = expenses.map((expense) => {
      if (expense.id !== firstTeamMinistryId) {
        return expense.noteMode === "auto" && isAutoTeamMinistryNote(expense.note)
          ? { ...expense, note: "", noteMode: undefined }
          : expense;
      }
      const shouldUpdate = expense.noteMode === "auto"
        || (expense.noteMode !== "manual" && (!expense.note.trim() || isAutoTeamMinistryNote(expense.note)));
      return shouldUpdate ? { ...expense, note: automaticNote, noteMode: "auto" as const } : expense;
    });
  } else {
    expenses = expenses.map((expense) => expense.noteMode === "auto" && isAutoTeamMinistryNote(expense.note)
      ? { ...expense, note: "", noteMode: undefined }
      : expense);
  }
  return { ...project, duesPerPerson, incomes, expenses, updatedAt: new Date().toISOString() };
}
