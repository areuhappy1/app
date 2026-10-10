"use client";

import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2, Wallet } from "lucide-react";
import type { Expense } from "@/lib/types";
import { parseAmountInput } from "@/lib/parser";
import { formatWon } from "@/lib/format";

interface Props {
  people: string[];
  expenses: Expense[];
  onAdd: (expense: Expense) => void;
  onRemove: (index: number) => void;
}

export default function ExpenseStep({ people, expenses, onAdd, onRemove }: Props) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState<string | null>(people[0] ?? null);
  /** 기본은 전체 선택. 여기 있는 이름만 체크 해제. */
  const [unchecked, setUnchecked] = useState<string[]>([]);
  const [hint, setHint] = useState("");

  const split = people.filter((p) => !unchecked.includes(p));

  useEffect(() => {
    setPayer((prev) => (prev && people.includes(prev) ? prev : people[0] ?? null));
    setUnchecked((prev) => prev.filter((p) => people.includes(p)));
  }, [people]);

  const toggleSplit = (name: string) => {
    setUnchecked((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (people.length === 0) {
      setHint("먼저 참여자를 등록해 주세요.");
      return;
    }
    const name = title.trim();
    const total = parseAmountInput(amount);
    if (!name) {
      setHint("항목 이름을 입력해 주세요.");
      return;
    }
    if (total <= 0) {
      setHint("금액을 입력해 주세요. (예: 50000 또는 5만)");
      return;
    }
    if (!payer) {
      setHint("낸 사람을 선택해 주세요.");
      return;
    }
    if (split.length === 0) {
      setHint("나눌 사람을 한 명 이상 선택해 주세요.");
      return;
    }

    onAdd({
      title: name,
      total,
      payers: [{ name: payer, amount: total }],
      participants: people.filter((p) => split.includes(p)),
    });
    setTitle("");
    setAmount("");
    setHint("");
  };

  const disabled = people.length === 0;

  return (
    <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-paper">
          2
        </span>
        <Wallet size={16} />
        지출 추가
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-neutral-500">
              항목
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="식당"
              disabled={disabled}
              className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 disabled:bg-neutral-50"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-neutral-500">
              금액
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50000"
              inputMode="decimal"
              disabled={disabled}
              className="w-28 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm tabular-nums text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 disabled:bg-neutral-50"
            />
          </label>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-neutral-500">
            낸 사람
          </div>
          {people.length === 0 ? (
            <p className="text-xs text-neutral-400">참여자가 없으면 선택할 수 없어요.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {people.map((name) => {
                const selected = payer === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setPayer(name)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition active:scale-95 ${
                      selected
                        ? "bg-ink text-paper"
                        : "bg-cream text-ink hover:bg-neutral-200"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-neutral-500">
            나눌 사람
            <span className="ml-1 font-normal text-neutral-400">기본 전체 · 빼려면 해제</span>
          </div>
          {people.length === 0 ? (
            <p className="text-xs text-neutral-400">참여자가 없으면 선택할 수 없어요.</p>
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {people.map((name) => {
                const checked = split.includes(name);
                return (
                  <label
                    key={name}
                    className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSplit(name)}
                      className="h-4 w-4 accent-ink"
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {hint && <p className="text-xs text-amber-700">{hint}</p>}

        <button
          type="submit"
          disabled={disabled}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition hover:opacity-90 active:scale-95 disabled:opacity-40"
        >
          <Plus size={16} />
          지출 추가
        </button>
      </form>

      {expenses.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-neutral-100 pt-3">
          {expenses.map((exp, i) => (
            <li
              key={`${exp.title}-${i}`}
              className="flex items-start justify-between gap-2 rounded-xl bg-cream/80 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="font-semibold text-ink">{exp.title}</span>
                  <span className="tabular-nums text-ink">{formatWon(exp.total)}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-neutral-500">
                  낸 사람 {exp.payers.map((p) => p.name).join(", ") || "-"} · 나눔{" "}
                  {exp.participants.join(", ") || "-"}
                </div>
              </div>
              <button
                type="button"
                aria-label={`${exp.title} 삭제`}
                onClick={() => onRemove(i)}
                className="shrink-0 rounded-lg p-1.5 text-neutral-400 transition hover:bg-white hover:text-ink"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
