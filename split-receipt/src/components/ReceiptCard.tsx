"use client";

import { forwardRef } from "react";
import type { SettlementResult } from "@/lib/types";
import { formatWon } from "@/lib/format";

interface Props {
  result: SettlementResult;
}

/**
 * 종이 영수증 스타일 카드. html-to-image로 캡처할 수 있도록 ref를 전달받는다.
 * 캡처 안정성을 위해 색상은 CSS 변수 대신 명시적 hex를 사용한다.
 */
const ReceiptCard = forwardRef<HTMLDivElement, Props>(function ReceiptCard(
  { result },
  ref
) {
  const { expenses, transfers, people, totalSpent, averagePerPerson } = result;

  return (
    <div className="mx-auto w-full max-w-sm">
      {/* 상단 톱니 */}
      <div className="receipt-edge-top" />
      <div
        ref={ref}
        className="bg-paper px-6 py-5 font-mono text-[13px] leading-relaxed text-ink shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
        style={{ backgroundColor: "#fdfcf7", color: "#2b2b2b" }}
      >
        {/* 헤더 */}
        <div className="text-center">
          <div className="text-lg font-bold tracking-[0.3em]">RECEIPT</div>
          <div className="mt-1 text-[11px] tracking-widest text-neutral-500">
            모임 정산 영수증
          </div>
          <div className="mt-1 text-[11px] text-neutral-400">
            {new Date().toLocaleDateString("ko-KR")}
          </div>
        </div>

        <hr className="dashed" />

        {/* 요약 */}
        <div className="space-y-1">
          <Row label="총 지출액" value={formatWon(totalSpent)} strong />
          <Row label="참석 인원" value={`${people.length}명`} />
          <Row label="1인당 평균" value={formatWon(averagePerPerson)} />
        </div>

        <hr className="dashed" />

        {/* 세부 내역 */}
        <div className="mb-1 text-[11px] font-bold tracking-widest text-neutral-500">
          ITEMS
        </div>
        <div className="space-y-2">
          {expenses.map((exp, i) => (
            <div key={i}>
              <Row label={exp.title} value={formatWon(exp.total)} />
              <div className="pl-1 text-[11px] text-neutral-500">
                결제 {exp.payers.map((p) => p.name).join(", ") || "-"} · 참여{" "}
                {exp.participants.join(", ") || "-"}
              </div>
            </div>
          ))}
          {expenses.length === 0 && (
            <div className="text-neutral-400">내역이 없습니다.</div>
          )}
        </div>

        <hr className="dashed" />

        {/* 최소 송금 하이라이트 */}
        <div
          className="rounded-md border-2 border-dashed border-neutral-400 bg-cream px-3 py-3"
          style={{ backgroundColor: "#f7f3e9" }}
        >
          <div className="mb-2 text-center text-[13px] font-bold">
            💸 이렇게만 송금하면 끝나요!
          </div>
          {transfers.length === 0 ? (
            <div className="text-center text-[12px] text-neutral-500">
              정산할 금액이 없어요. 이미 딱 맞습니다 🎉
            </div>
          ) : (
            <div className="space-y-1">
              {transfers.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-[13px]"
                >
                  <span className="font-semibold">
                    {t.from} <span className="text-neutral-400">➡️</span> {t.to}
                  </span>
                  <span className="font-bold">{formatWon(t.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <hr className="dashed" />

        <div className="text-center text-[10px] tracking-widest text-neutral-400">
          *** THANK YOU ***
          <br />
          made with split-receipt
        </div>
      </div>
      {/* 하단 톱니 */}
      <div className="receipt-edge-bottom" />
    </div>
  );
});

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? "font-bold" : ""}>{label}</span>
      <span
        className={`flex-shrink-0 ${strong ? "text-base font-bold" : ""}`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </span>
    </div>
  );
}

export default ReceiptCard;
