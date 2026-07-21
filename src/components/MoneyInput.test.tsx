// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MoneyInput, { formatMoneyInput, parseMoneyInput } from "./MoneyInput";

describe("금액 입력", () => {
  afterEach(cleanup);

  it("숫자값을 세 자리 콤마 형식으로 표시한다", () => {
    expect(formatMoneyInput(1_234_567)).toBe("1,234,567");
    expect(parseMoneyInput("1,234,567원")).toBe(1_234_567);
  });

  it("수정 중인 값에도 콤마를 적용하고 숫자값만 전달한다", () => {
    const onChange = vi.fn();
    render(<MoneyInput aria-label="금액" value={420_000} onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: "금액" }) as HTMLInputElement;
    expect(input.value).toBe("420,000");

    fireEvent.change(input, { target: { value: "1,250,000", selectionStart: 9 } });
    expect(input.value).toBe("1,250,000");
    expect(onChange).toHaveBeenLastCalledWith(1_250_000);
  });
});
