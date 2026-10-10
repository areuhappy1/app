"use client";

import { useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Receipt, Download, Copy, Check, AlertTriangle } from "lucide-react";
import { settle } from "@/lib/settlement";
import { buildKakaoText } from "@/lib/format";
import {
  dropPersonFromExpenses,
  peopleFromExpenses,
} from "@/lib/people";
import type { Expense } from "@/lib/types";
import ReceiptCard from "@/components/ReceiptCard";
import ParticipantStep from "@/components/ParticipantStep";
import ExpenseStep from "@/components/ExpenseStep";
import AutoFillPanel from "@/components/AutoFillPanel";

export default function Home() {
  const [people, setPeople] = useState<string[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const result = useMemo(() => {
    if (expenses.length === 0) return null;
    return settle(expenses);
  }, [expenses]);

  const warnings = useMemo(() => {
    if (!result) return [];
    const list: string[] = [];
    for (const exp of result.expenses) {
      const paid = exp.payers.reduce((s, p) => s + p.amount, 0);
      if (exp.payers.length === 0) {
        list.push(`"${exp.title}" 항목의 결제자를 찾지 못했어요.`);
      } else if (Math.abs(paid - exp.total) > 1) {
        list.push(
          `"${exp.title}" 항목의 결제자 합계(${paid.toLocaleString()}원)가 총액(${exp.total.toLocaleString()}원)과 달라요.`
        );
      }
      if (exp.participants.length === 0) {
        list.push(`"${exp.title}" 항목의 참여자를 찾지 못했어요.`);
      }
    }
    return list;
  }, [result]);

  const handlePeopleChange = (next: string[]) => {
    const removed = people.filter((p) => !next.includes(p));
    setPeople(next);
    if (removed.length === 0) return;
    setExpenses((prev) =>
      removed.reduce((acc, name) => dropPersonFromExpenses(acc, name), prev)
    );
  };

  const handleAutoFill = (parsed: Expense[]) => {
    setPeople((prev) => peopleFromExpenses(parsed, prev));
    setExpenses((prev) => [...prev, ...parsed]);
  };

  const handleSavePng = async () => {
    if (!cardRef.current) return;
    setSaving(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#fdfcf7",
      });
      const link = document.createElement("a");
      link.download = `정산영수증_${new Date()
        .toISOString()
        .slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error(err);
      alert("이미지 저장에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    const kakao = buildKakaoText(result);
    try {
      await navigator.clipboard.writeText(kakao);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = kakao;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-8">
      <header className="mb-6 text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-paper">
          <Receipt size={16} />
          split-receipt
        </div>
        <h1 className="text-xl font-bold text-ink">모임 1/N 정산</h1>
        <p className="mt-1 text-sm text-neutral-500">
          참여자를 넣고 지출만 찍으면
          <br />
          최소 송금 경로를 영수증으로 정리해요.
        </p>
      </header>

      <ParticipantStep people={people} onChange={handlePeopleChange} />

      <ExpenseStep
        people={people}
        expenses={expenses}
        onAdd={(exp) => setExpenses((prev) => [...prev, exp])}
        onRemove={(index) =>
          setExpenses((prev) => prev.filter((_, i) => i !== index))
        }
      />

      <AutoFillPanel onApply={handleAutoFill} />

      {warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={14} />
            확인이 필요해요
          </div>
          <ul className="list-disc space-y-0.5 pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {result ? (
        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-paper">
              3
            </span>
            영수증 · 최소 송금
          </div>
          <ReceiptCard ref={cardRef} result={result} />

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleSavePng}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper transition hover:opacity-90 active:scale-95 disabled:opacity-50"
            >
              <Download size={16} />
              {saving ? "저장 중..." : "이미지 저장 (PNG)"}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-ink bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-neutral-50 active:scale-95"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "복사 완료!" : "카톡 텍스트 복사"}
            </button>
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white/50 p-8 text-center text-sm text-neutral-400">
          참여자와 지출을 넣으면
          <br />
          여기에 영수증이 나타나요.
        </div>
      )}

      <footer className="mt-10 text-center text-[11px] text-neutral-400">
        계산은 100% 브라우저 안에서 처리되며, 입력 내용은 저장되지 않습니다.
      </footer>
    </main>
  );
}
