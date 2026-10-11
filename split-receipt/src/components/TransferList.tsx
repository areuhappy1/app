"use client";

import { MouseEvent, useState } from "react";
import { Copy, Send } from "lucide-react";
import type { BankAccount, Transfer } from "@/lib/types";
import { formatWon } from "@/lib/format";
import { copyText } from "@/lib/clipboard";
import { accountText, buildTossLink, isMobileDevice, isUsableAccount } from "@/lib/toss";

interface Props {
  transfers: Transfer[];
  accounts: Record<string, BankAccount>;
}

export default function TransferList({ transfers, accounts }: Props) {
  const [notice, setNotice] = useState<{ index: number; text: string } | null>(null);

  if (transfers.length === 0) {
    return (
      <p className="rounded-xl bg-white p-4 text-center text-sm text-neutral-500">
        보낼 돈이 없어요. 이미 딱 맞아요 🎉
      </p>
    );
  }

  const flash = (index: number, text: string) => {
    setNotice({ index, text });
    setTimeout(() => setNotice((n) => (n?.index === index ? null : n)), 2500);
  };

  const copyAccount = async (index: number, t: Transfer, acc: BankAccount) => {
    const ok = await copyText(`${accountText(acc)} ${t.amount}`);
    flash(index, ok ? "계좌번호와 금액을 복사했어요." : "복사에 실패했어요.");
  };

  const handleToss = (e: MouseEvent, index: number, t: Transfer, acc: BankAccount) => {
    void copyText(`${accountText(acc)} ${t.amount}`);
    if (!isMobileDevice()) {
      e.preventDefault();
      flash(index, "토스는 휴대폰에서 열려요. 대신 계좌번호를 복사했어요.");
    }
  };

  return (
    <ul className="space-y-2">
      {transfers.map((t, i) => {
        const acc = accounts[t.to];
        const ready = isUsableAccount(acc);
        return (
          <li
            key={`${t.from}-${t.to}-${i}`}
            className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-ink">
                {t.from} <span className="text-neutral-400">→</span> {t.to}
              </span>
              <span className="font-mono text-base font-extrabold tabular-nums text-ink">
                {formatWon(t.amount)}
              </span>
            </div>

            {ready ? (
              <>
                <div className="mt-0.5 text-right font-mono text-[11px] text-neutral-500">
                  {accountText(acc)}
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                  <a
                    href={buildTossLink(acc, t.amount)}
                    onClick={(e) => handleToss(e, i, t, acc)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0064ff] px-3 py-2.5 text-sm font-bold text-white transition hover:opacity-90 active:scale-95"
                  >
                    <Send size={15} />
                    토스로 {formatWon(t.amount)} 보내기
                  </a>
                  <button
                    type="button"
                    onClick={() => copyAccount(i, t, acc)}
                    aria-label="계좌번호 복사"
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-xs font-semibold text-ink transition hover:bg-neutral-50 active:scale-95"
                  >
                    <Copy size={14} />
                    계좌
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-1 text-[11px] text-neutral-400">
                {t.to}님 계좌가 아직 없어요.
              </div>
            )}

            {notice?.index === i && (
              <p className="mt-2 text-[11px] text-[#2f7d4f]">{notice.text}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
