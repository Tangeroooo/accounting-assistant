import { describe, expect, it } from "vitest";

import { createEmptyProject, type Expense } from "../types";
import { buildReceiptBookItems, paginateReceiptItems, receiptGridPosition } from "./receipt-book";

const expense = (index: number): Expense => ({
  id: `expense-${index}`,
  createdOrder: index,
  category: "meals",
  date: `2026-07-${String(index).padStart(2, "0")}`,
  content: `식사 ${index}`,
  amount: index * 10_000,
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
  receiptNumber: index,
});

describe("영수증철 페이지 구성", () => {
  it("금전출납부 순서의 영수증을 여섯 개씩 페이지로 나눈다", () => {
    const project = createEmptyProject();
    project.expenses = Array.from({ length: 8 }, (_, index) => expense(index + 1));
    const pages = paginateReceiptItems(buildReceiptBookItems(project));
    expect(pages.map((page) => page.map((item) => item.expense.id))).toEqual([
      ["expense-1", "expense-2", "expense-3", "expense-4", "expense-5", "expense-6"],
      ["expense-7", "expense-8"],
    ]);
  });

  it("왼쪽 위에서 아래로 채운 뒤 오른쪽 열로 이동한다", () => {
    expect(Array.from({ length: 6 }, (_, index) => receiptGridPosition(index))).toEqual([
      { column: 0, row: 0 },
      { column: 0, row: 1 },
      { column: 0, row: 2 },
      { column: 1, row: 0 },
      { column: 1, row: 1 },
      { column: 1, row: 2 },
    ]);
  });
});
