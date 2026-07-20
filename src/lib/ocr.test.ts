import { describe, expect, it } from "vitest";

import { guessFromText } from "./ocr";

describe("오픈소스 영수증 텍스트 후보 정리", () => {
  it("숫자와 기호가 대부분인 깨진 문자열을 상호명으로 제안하지 않는다", () => {
    const result = guessFromText("25. 12. 27. 오후 1:08 08/01611.004[08119.0017/42/0810-[8061211016\\?0106110=21100161265368&\\61001108= ㅅ 00010028&08107081=13156");

    expect(result.date).toBe("2025-12-27");
    expect(result.merchant).toBeUndefined();
    expect(result.amount).toBeUndefined();
    expect(result.quality).toBe("partial");
  });

  it("읽을 수 있는 영수증에서는 날짜·금액·상호 후보를 유지한다", () => {
    const result = guessFromText("25. 12. 27. 오후 1:08\n거래일시 2025/12/23 21:19:24\n판매자상호 쿠팡(주)\n결제금액 295,860원\n위 신용카드 매출전표는 관련 법령에 의거하여 발행되었습니다");

    expect(result).toMatchObject({
      date: "2025-12-23",
      amount: 295_860,
      merchant: "쿠팡(주)",
      quality: "usable",
    });
  });
});
