import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";

export function parseMoneyInput(value: string) {
  const normalized = value.replaceAll(",", "").replace(/[^\d.]/g, "");
  const [integer = "", ...fractions] = normalized.split(".");
  const numeric = fractions.length > 0
    ? `${integer || "0"}.${fractions.join("").slice(0, 6)}`
    : integer;
  if (!numeric || numeric === ".") return 0;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? Math.min(parsed, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
}

export function formatMoneyInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
}

function formatMoneyDraft(value: string) {
  const normalized = value.replaceAll(",", "").replace(/[^\d.]/g, "");
  const hasDecimalPoint = normalized.includes(".");
  const [rawInteger = "", ...rawFractions] = normalized.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  const groupedInteger = integer ? Number(integer).toLocaleString("ko-KR") : hasDecimalPoint ? "0" : "";
  if (!hasDecimalPoint) return groupedInteger;
  return `${groupedInteger}.${rawFractions.join("").slice(0, 6)}`;
}

type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "inputMode" | "onChange" | "type" | "value"> & {
  value: number;
  onChange: (value: number) => void;
};

export default function MoneyInput({ value, onChange, ...inputProps }: MoneyInputProps) {
  const [displayValue, setDisplayValue] = useState(() => formatMoneyInput(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const caretNumericIndexRef = useRef<number | null>(null);

  useEffect(() => {
    setDisplayValue(formatMoneyInput(value));
  }, [value]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const caretNumericIndex = caretNumericIndexRef.current;
    if (!input || caretNumericIndex === null || document.activeElement !== input) return;

    let nextCaret = displayValue.length;
    if (caretNumericIndex === 0) {
      nextCaret = 0;
    } else {
      let numericCharactersSeen = 0;
      for (let index = 0; index < displayValue.length; index += 1) {
        if (/[\d.]/.test(displayValue[index])) numericCharactersSeen += 1;
        if (numericCharactersSeen === caretNumericIndex) {
          nextCaret = index + 1;
          break;
        }
      }
    }
    input.setSelectionRange(nextCaret, nextCaret);
    caretNumericIndexRef.current = null;
  }, [displayValue]);

  return <input
    {...inputProps}
    ref={inputRef}
    type="text"
    inputMode="decimal"
    pattern="[0-9,.]*"
    value={displayValue}
    onChange={(event) => {
      const caret = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
      caretNumericIndexRef.current = event.currentTarget.value.slice(0, caret).replace(/[^\d.]/g, "").length;
      const nextValue = parseMoneyInput(event.currentTarget.value);
      setDisplayValue(formatMoneyDraft(event.currentTarget.value));
      onChange(nextValue);
    }}
    onBlur={(event) => {
      setDisplayValue(formatMoneyInput(value));
      inputProps.onBlur?.(event);
    }}
  />;
}
