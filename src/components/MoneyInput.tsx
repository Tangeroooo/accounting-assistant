import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";

export function parseMoneyInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return 0;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function formatMoneyInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return Math.trunc(value).toLocaleString("ko-KR");
}

type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "inputMode" | "onChange" | "type" | "value"> & {
  value: number;
  onChange: (value: number) => void;
};

export default function MoneyInput({ value, onChange, ...inputProps }: MoneyInputProps) {
  const [displayValue, setDisplayValue] = useState(() => formatMoneyInput(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const caretDigitIndexRef = useRef<number | null>(null);

  useEffect(() => {
    setDisplayValue(formatMoneyInput(value));
  }, [value]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const caretDigitIndex = caretDigitIndexRef.current;
    if (!input || caretDigitIndex === null || document.activeElement !== input) return;

    let nextCaret = displayValue.length;
    if (caretDigitIndex === 0) {
      nextCaret = 0;
    } else {
      let digitsSeen = 0;
      for (let index = 0; index < displayValue.length; index += 1) {
        if (/\d/.test(displayValue[index])) digitsSeen += 1;
        if (digitsSeen === caretDigitIndex) {
          nextCaret = index + 1;
          break;
        }
      }
    }
    input.setSelectionRange(nextCaret, nextCaret);
    caretDigitIndexRef.current = null;
  }, [displayValue]);

  return <input
    {...inputProps}
    ref={inputRef}
    type="text"
    inputMode="numeric"
    pattern="[0-9,]*"
    value={displayValue}
    onChange={(event) => {
      const caret = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
      caretDigitIndexRef.current = event.currentTarget.value.slice(0, caret).replace(/\D/g, "").length;
      const nextValue = parseMoneyInput(event.currentTarget.value);
      setDisplayValue(formatMoneyInput(nextValue));
      onChange(nextValue);
    }}
  />;
}
