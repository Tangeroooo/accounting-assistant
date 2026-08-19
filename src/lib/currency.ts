import {
  CURRENCY_DEFINITIONS,
  type AccountingRegion,
  type CurrencyCode,
  type ExchangeRatesToKrw,
  type Expense,
  type ProjectData,
} from "../types";

const MAX_FRACTION_DIGITS = 6;
const PRECISION = 10 ** MAX_FRACTION_DIGITS;

export function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * PRECISION) / PRECISION;
}

export function projectAccountingRegion(project: Pick<ProjectData, "meta">): AccountingRegion {
  return project.meta.accountingRegion === "overseas" ? "overseas" : "domestic";
}

export function accountingRegionLabel(project: Pick<ProjectData, "meta">) {
  return projectAccountingRegion(project) === "overseas" ? "해외" : "국내";
}

export function expenseCurrency(expense: Pick<Expense, "currency">): CurrencyCode {
  return CURRENCY_DEFINITIONS.some((definition) => definition.code === expense.currency)
    ? expense.currency!
    : "KRW";
}

export function currencyDefinition(currency: CurrencyCode) {
  return CURRENCY_DEFINITIONS.find((definition) => definition.code === currency)!;
}

export function isForeignExpense(expense: Pick<Expense, "currency">) {
  return expenseCurrency(expense) !== "KRW";
}

export function hasExchangeRate(expense: Pick<Expense, "currency" | "exchangeRateToKrw">) {
  return hasExchangeRateForCurrency(expenseCurrency(expense), undefined, expense.exchangeRateToKrw);
}

export function hasExchangeRateForCurrency(
  currency: CurrencyCode,
  rates?: ExchangeRatesToKrw,
  legacyRate?: number,
) {
  if (currency === "KRW") return true;
  const rate = rates?.[currency] ?? legacyRate;
  return Number.isFinite(rate) && (rate ?? 0) > 0;
}

/** 공식 검산·정산·Excel에 사용하는 원화 금액입니다. 환율이 없으면 0원으로 둡니다. */
export function expenseAmountKrw(
  expense: Pick<Expense, "amount" | "currency" | "exchangeRateToKrw">,
  rates?: ExchangeRatesToKrw,
) {
  const amount = Math.max(0, Number.isFinite(expense.amount) ? expense.amount : 0);
  if (!isForeignExpense(expense)) return roundMoney(amount);
  const currency = expenseCurrency(expense);
  const rate = currency === "KRW" ? 1 : rates?.[currency] ?? expense.exchangeRateToKrw;
  if (!hasExchangeRateForCurrency(currency, rates, expense.exchangeRateToKrw)) return 0;
  return roundMoney(amount * (rate ?? 0));
}

export function projectExchangeRates(project: Pick<ProjectData, "exchangeRatesToKrw" | "expenses">) {
  const rates: ExchangeRatesToKrw = { ...project.exchangeRatesToKrw };
  for (const expense of project.expenses) {
    const currency = expenseCurrency(expense);
    if (currency === "KRW" || rates[currency] !== undefined) continue;
    if (Number.isFinite(expense.exchangeRateToKrw) && (expense.exchangeRateToKrw ?? 0) > 0) {
      rates[currency] = expense.exchangeRateToKrw;
    }
  }
  return rates;
}

export function projectExpenseAmountKrw(
  project: Pick<ProjectData, "exchangeRatesToKrw" | "expenses">,
  expense: Pick<Expense, "amount" | "currency" | "exchangeRateToKrw">,
) {
  return expenseAmountKrw(expense, projectExchangeRates(project));
}

export function formatDecimalAmount(value: number) {
  const normalized = Number.isFinite(value) ? value : 0;
  return normalized.toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: MAX_FRACTION_DIGITS,
  });
}

export function formatKrw(value: number) {
  return `${formatDecimalAmount(roundMoney(value))}원`;
}

export function formatExpenseAmount(
  expense: Pick<Expense, "amount" | "currency">,
  options: { includeCode?: boolean } = {},
) {
  const currency = expenseCurrency(expense);
  if (currency === "KRW") return `${formatDecimalAmount(expense.amount)}원`;
  const definition = currencyDefinition(currency);
  const label = `${definition.symbol}${formatDecimalAmount(expense.amount)}`;
  return options.includeCode === false ? label : `${label} ${currency}`;
}
