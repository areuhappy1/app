"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Receipt,
  Image as ImageIcon,
  Copy,
  Check,
  AlertTriangle,
  MessageCircle,
  ExternalLink,
} from "lucide-react";
import { settle } from "@/lib/settlement";
import { buildKakaoText } from "@/lib/format";
import { dropPersonFromExpenses, peopleFromExpenses } from "@/lib/people";
import { buildShareUrl, readShareFromHash, type SharePayload } from "@/lib/share";
import { shareLink, shareReceiptImage } from "@/lib/shareActions";
import { copyText } from "@/lib/clipboard";
import type { BankAccount, Expense } from "@/lib/types";
import ReceiptCard from "@/components/ReceiptCard";
import ParticipantStep from "@/components/ParticipantStep";
import ExpenseStep from "@/components/ExpenseStep";
import AutoFillPanel from "@/components/AutoFillPanel";
import AccountPanel from "@/components/AccountPanel";
import SharedView from "@/components/SharedView";

export default function Home() {
  const [people, setPeople] = useState<string[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [title, setTitle] = useState("");
  const [accounts, setAccounts] = useState<Record<string, BankAccount>>({});
  const [shared, setShared] = useState<SharePayload | null>(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setShared(readShareFromHash(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const result = useMemo(() => {
    if (expenses.length === 0) return null;
    return settle(expenses);
  }, [expenses]);

  const receivers = useMemo(
    () => (result ? Array.from(new Set(result.transfers.map((t) => t.to))) : []),
    [result]
  );

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

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? "" : n)), 3000);
  };

  const clearHash = () => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setShared(null);
  };

  const handlePeopleChange = (next: string[]) => {
    const removed = people.filter((p) => !next.includes(p));
    setPeople(next);
    if (removed.length === 0) return;
    setExpenses((prev) =>
      removed.reduce((acc, name) => dropPersonFromExpenses(acc, name), prev)
    );
    setAccounts((prev) => {
      const nextAccounts = { ...prev };
      for (const name of removed) delete nextAccounts[name];
      return nextAccounts;
    });
  };

  const handleAutoFill = (parsed: Expense[]) => {
    setPeople((prev) => peopleFromExpenses(parsed, prev));
    setExpenses((prev) => [...prev, ...parsed]);
  };

  const currentShareUrl = () => {
    const relevant: Record<string, BankAccount> = {};
    for (const name of receivers) {
      if (accounts[name]?.number) relevant[name] = accounts[name];
    }
    const base = window.location.origin + window.location.pathname;
    return buildShareUrl(base, { title: title.trim(), people, expenses, accounts: relevant });
  };

  const handleShareLink = async () => {
    if (!result) return;
    const url = currentShareUrl();
    const text = buildKakaoText(result, { title: title.trim(), accounts });
    const outcome = await shareLink(`${title.trim() || "모임"} 정산`, text, url);
    if (outcome === "copied") flash("정산 내용과 링크를 복사했어요. 단톡방에 붙여넣어 주세요.");
    if (outcome === "failed") flash("복사에 실패했어요. 다시 시도해 주세요.");
  };

  const handleSaveImage = async () => {
    if (!cardRef.current) return;
    setSaving(true);
    try {
      const outcome = await shareReceiptImage(cardRef.current, title.trim());
      if (outcome === "downloaded") flash("영수증 이미지를 저장했어요.");
      if (outcome === "failed") flash("이미지 저장에 실패했어요. 다시 시도해 주세요.");
    } catch (err) {
      console.error(err);
      flash("이미지 저장에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    const text = buildKakaoText(result, {
      title: title.trim(),
      accounts,
      shareUrl: currentShareUrl(),
    });
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (shared) {
    return (
      <SharedView
        payload={shared}
        onEdit={() => {
          setPeople(shared.people);
          setExpenses(shared.expenses);
          setAccounts(shared.accounts);
          setTitle(shared.title);
          clearHash();
        }}
        onNew={() => {
          setPeople([]);
          setExpenses([]);
          setAccounts({});
          setTitle("");
          clearHash();
        }}
      />
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-8">
      <header className="mb-6 text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-paper">
          <Receipt size={16} />
          split-receipt
        </div>
        <h1 className="text-xl font-bold text-ink">모임 1/N 정산</h1>
        <p className="mt-1 text-sm text-neutral-500">
          앱 설치 없이, 지출만 찍으면
          <br />
          영수증과 토스 송금 링크까지 한 번에.
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
            영수증 · 단톡방 공유
          </div>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 40))}
            placeholder="모임 이름 (예: 10월 강릉 여행)"
            aria-label="모임 이름"
            className="mb-3 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          />

          <AccountPanel
            receivers={receivers}
            accounts={accounts}
            onChange={(name, account) => setAccounts((prev) => ({ ...prev, [name]: account }))}
          />

          <ReceiptCard ref={cardRef} result={result} title={title.trim()} accounts={accounts} />

          <button
            type="button"
            onClick={handleShareLink}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#fee500] px-4 py-3.5 text-sm font-bold text-[#191919] transition hover:opacity-90 active:scale-95"
          >
            <MessageCircle size={18} />
            단톡방에 정산 링크 보내기
          </button>
          <p className="mt-1.5 text-center text-[11px] text-neutral-500">
            친구들은 링크만 열면 영수증을 보고 토스로 바로 보낼 수 있어요.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleSaveImage}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper transition hover:opacity-90 active:scale-95 disabled:opacity-50"
            >
              <ImageIcon size={16} />
              {saving ? "만드는 중..." : "영수증 이미지"}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-ink bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-neutral-50 active:scale-95"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "복사 완료!" : "텍스트 복사"}
            </button>
          </div>

          {notice && (
            <p className="mt-3 rounded-lg bg-white px-3 py-2 text-center text-xs text-ink">
              {notice}
            </p>
          )}

          <button
            type="button"
            onClick={() => window.open(currentShareUrl(), "_blank")}
            className="mx-auto mt-4 flex items-center gap-1 text-[11px] text-neutral-500 underline-offset-2 hover:underline"
          >
            <ExternalLink size={12} />
            친구가 받는 화면 미리보기
          </button>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white/50 p-8 text-center text-sm text-neutral-400">
          참여자와 지출을 넣으면
          <br />
          여기에 영수증이 나타나요.
        </div>
      )}

      <footer className="mt-10 text-center text-[11px] text-neutral-400">
        서버에 아무것도 저장하지 않아요. 정산 내용은 공유 링크 안에만 담겨요.
      </footer>
    </main>
  );
}
