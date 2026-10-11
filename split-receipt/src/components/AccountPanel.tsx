"use client";

import { Landmark } from "lucide-react";
import type { BankAccount } from "@/lib/types";
import { BANKS, cleanAccountNumber, isUsableAccount } from "@/lib/toss";

interface Props {
  /** 돈을 받을 사람만 */
  receivers: string[];
  accounts: Record<string, BankAccount>;
  onChange: (name: string, account: BankAccount) => void;
}

export default function AccountPanel({ receivers, accounts, onChange }: Props) {
  if (receivers.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <Landmark size={16} />
        받을 사람 계좌
        <span className="text-[11px] font-normal text-neutral-400">선택</span>
      </div>
      <p className="mb-3 text-[11px] text-neutral-500">
        넣어두면 영수증에 계좌가 찍히고, 친구들은 토스 버튼 한 번으로 보낼 수 있어요.
      </p>

      <div className="space-y-2">
        {receivers.map((name) => {
          const acc = accounts[name] ?? { bank: BANKS[0].code, number: "" };
          const ready = isUsableAccount(acc);
          return (
            <div key={name} className="grid grid-cols-[4.5rem_6.5rem_1fr] items-center gap-2">
              <span className="truncate text-sm font-semibold text-ink">
                {name}
                {ready && <span className="ml-1 text-[#2f7d4f]">✓</span>}
              </span>
              <select
                aria-label={`${name} 은행`}
                value={acc.bank}
                onChange={(e) => onChange(name, { ...acc, bank: e.target.value })}
                className="rounded-xl border border-neutral-300 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-ink"
              >
                {BANKS.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </select>
              <input
                aria-label={`${name} 계좌번호`}
                value={acc.number}
                onChange={(e) =>
                  onChange(name, { ...acc, number: cleanAccountNumber(e.target.value) })
                }
                placeholder="계좌번호"
                inputMode="numeric"
                className="min-w-0 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm tabular-nums text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
