"use client";

import { forwardRef } from "react";
import type { BankAccount, SettlementResult } from "@/lib/types";
import { formatWon } from "@/lib/format";
import { accountText, isUsableAccount } from "@/lib/toss";

interface Props {
  result: SettlementResult;
  title?: string;
  accounts?: Record<string, BankAccount>;
}

const COLOR = {
  frame: "#efe9dc",
  paper: "#fdfcf7",
  ink: "#2b2b2b",
  muted: "#8a8478",
  line: "#c9c2b0",
  receive: "#2f7d4f",
  send: "#c2410c",
};

/**
 * 단톡방에 올릴 종이 영수증 카드. ref가 가리키는 배경 프레임째로 이미지로 저장된다.
 * html-to-image 캡처 안정성을 위해 색상은 CSS 변수 대신 명시적 hex를 사용한다.
 */
const ReceiptCard = forwardRef<HTMLDivElement, Props>(function ReceiptCard(
  { result, title, accounts = {} },
  ref
) {
  const { expenses, transfers, balances, people, totalSpent, averagePerPerson } = result;
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto w-full max-w-[360px]">
      {/* 캡처 대상. 바깥 mx-auto 여백까지 복제되면 이미지가 한쪽으로 밀려 잘린다. */}
      <div ref={ref} className="px-4 py-5" style={{ backgroundColor: COLOR.frame }}>
        <div className="receipt-edge-top" />
        <div
          className="px-6 pb-6 pt-4 text-[13px] leading-relaxed shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
          style={{ backgroundColor: COLOR.paper, color: COLOR.ink }}
        >
          <div
            className="flex items-center justify-between font-mono text-[10px] tracking-widest"
            style={{ color: COLOR.muted }}
          >
            <span>RECEIPT</span>
            <span>{today}</span>
          </div>

          <div className="mt-3 text-center">
            <div className="break-keep text-[22px] font-extrabold leading-tight">
              {title || "모임 정산"}
            </div>
            <div className="mt-1 text-[11px]" style={{ color: COLOR.muted }}>
              {people.length}명 · 지출 {expenses.length}건
            </div>
          </div>

          <Divider />

          <div className="text-center">
            <div className="text-[11px] font-semibold" style={{ color: COLOR.muted }}>
              총 지출
            </div>
            <div className="whitespace-nowrap font-mono text-[28px] font-extrabold tabular-nums leading-tight">
              {formatWon(totalSpent)}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: COLOR.muted }}>
              1인 평균 {formatWon(averagePerPerson)}
            </div>
          </div>

          <Divider />

          <SectionLabel>내역</SectionLabel>
          <div className="space-y-2">
            {expenses.map((exp, i) => (
              <div key={i}>
                <LeaderRow label={exp.title} value={formatWon(exp.total)} />
                <div className="text-[11px]" style={{ color: COLOR.muted }}>
                  {exp.payers.map((p) => p.name).join(", ")} 결제 ·{" "}
                  {exp.participants.length === people.length
                    ? "전원"
                    : exp.participants.join(", ")}
                </div>
              </div>
            ))}
          </div>

          <Divider />

          <SectionLabel>개인별</SectionLabel>
          <div className="space-y-1">
            {balances.map((b) => (
              <div key={b.name} className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{b.name}</span>
                <span className="flex items-baseline gap-2 whitespace-nowrap font-mono tabular-nums">
                  <span className="text-[11px]" style={{ color: COLOR.muted }}>
                    부담 {formatWon(b.owed)}
                  </span>
                  <span
                    className="min-w-[84px] text-right text-[12px] font-bold"
                    style={{
                      color: b.net > 0 ? COLOR.receive : b.net < 0 ? COLOR.send : COLOR.muted,
                    }}
                  >
                    {b.net > 0
                      ? `+${formatWon(b.net)}`
                      : b.net < 0
                        ? `-${formatWon(-b.net)}`
                        : "완료"}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div
            className="mt-5 rounded-xl px-4 py-4"
            style={{ backgroundColor: COLOR.ink, color: COLOR.paper }}
          >
            <div className="mb-3 text-center text-[13px] font-bold">💸 이렇게만 보내면 끝!</div>
            {transfers.length === 0 ? (
              <div className="text-center text-[12px] opacity-80">
                보낼 돈이 없어요. 이미 딱 맞아요 🎉
              </div>
            ) : (
              <div className="space-y-2.5">
                {transfers.map((t, i) => {
                  const acc = accounts[t.to];
                  return (
                    <div key={i}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">
                          {t.from} <span className="opacity-60">→</span> {t.to}
                        </span>
                        <span className="whitespace-nowrap font-mono text-[15px] font-extrabold tabular-nums">
                          {formatWon(t.amount)}
                        </span>
                      </div>
                      {isUsableAccount(acc) && (
                        <div className="whitespace-nowrap text-right font-mono text-[11px] opacity-70">
                          {accountText(acc)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div
            className="mx-auto mt-6 h-9 w-48"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, ${COLOR.ink} 0 2px, transparent 2px 4px, ${COLOR.ink} 4px 5px, transparent 5px 8px, ${COLOR.ink} 8px 11px, transparent 11px 13px)`,
            }}
          />
          <div
            className="mt-2 text-center font-mono text-[10px] tracking-[0.3em]"
            style={{ color: COLOR.muted }}
          >
            THANK YOU · SPLIT-RECEIPT
          </div>
        </div>
        <div className="receipt-edge-bottom" />
      </div>
    </div>
  );
});

function Divider() {
  return <hr className="dashed" style={{ borderTopColor: COLOR.line, margin: "16px 0" }} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 text-[11px] font-bold tracking-widest"
      style={{ color: COLOR.muted }}
    >
      {children}
    </div>
  );
}

function LeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="max-w-[70%] font-semibold">{label}</span>
      <span
        className="min-w-0 flex-1 translate-y-[-3px] border-b border-dotted"
        style={{ borderColor: COLOR.line }}
      />
      <span className="shrink-0 whitespace-nowrap font-mono tabular-nums">{value}</span>
    </div>
  );
}

export default ReceiptCard;
