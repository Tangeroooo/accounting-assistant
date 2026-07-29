import type { Attachment, ProjectData } from "../types";

function mergeAttachmentList(
  sourceAttachments: Attachment[],
  normalizedAttachments: Attachment[],
  currentAttachments: Attachment[],
) {
  const sourceIds = new Set(sourceAttachments.map((attachment) => attachment.id));
  const normalizedIds = new Set(normalizedAttachments.map((attachment) => attachment.id));
  const currentById = new Map(currentAttachments.map((attachment) => [attachment.id, attachment]));

  const normalized = normalizedAttachments.map((attachment) => {
    const current = currentById.get(attachment.id);
    if (!current) return attachment;
    return {
      ...attachment,
      kind: current.kind,
      layout: current.layout ?? attachment.layout,
    };
  });
  const addedWhileNormalizing = currentAttachments.filter(
    (attachment) => !sourceIds.has(attachment.id) && !normalizedIds.has(attachment.id),
  );
  return [...normalized, ...addedWhileNormalizing];
}

/**
 * 이미지 준비는 시간이 오래 걸릴 수 있으므로, 시작 시점의 프로젝트 전체를
 * 그대로 덮어쓰지 않고 첨부 변환 결과만 현재 프로젝트에 병합합니다.
 */
export function mergeAttachmentMigrationResult(
  source: ProjectData,
  normalized: ProjectData,
  current: ProjectData,
) {
  const sourceExpenses = new Map(source.expenses.map((expense) => [expense.id, expense]));
  const normalizedExpenses = new Map(normalized.expenses.map((expense) => [expense.id, expense]));
  const sourceEvidence = new Map(source.categoryEvidence.map((evidence) => [evidence.id, evidence]));
  const normalizedEvidence = new Map(normalized.categoryEvidence.map((evidence) => [evidence.id, evidence]));

  return {
    ...current,
    expenses: current.expenses.map((expense) => {
      const sourceExpense = sourceExpenses.get(expense.id);
      const normalizedExpense = normalizedExpenses.get(expense.id);
      if (!sourceExpense || !normalizedExpense) return expense;
      return {
        ...expense,
        attachments: mergeAttachmentList(
          sourceExpense.attachments,
          normalizedExpense.attachments,
          expense.attachments,
        ),
      };
    }),
    categoryEvidence: current.categoryEvidence.map((evidence) => {
      const sourceItem = sourceEvidence.get(evidence.id);
      const normalizedItem = normalizedEvidence.get(evidence.id);
      if (!sourceItem || !normalizedItem) return evidence;
      return {
        ...evidence,
        attachments: mergeAttachmentList(
          sourceItem.attachments,
          normalizedItem.attachments,
          evidence.attachments,
        ),
      };
    }),
  };
}
