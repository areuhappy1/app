"use client";

import { useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  Receipt,
  Sparkles,
  Download,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";
import { parseMemo } from "@/lib/parser";
import { settle } from "@/lib/settlement";
import { buildKakaoText } from "@/lib/format";
import { EXAMPLES } from "@/lib/examples";
import ReceiptCard from "@/components/ReceiptCard";

export default function Home() {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 입력이 바뀔 때마다 파싱 + 정산 (순수 함수, 메모이즈)
  const result = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const expenses = parseMemo(trimmed);
    if (expenses.length === 0) return null;
    return settle(expenses);
  }, [text]);

  // payers 합계 ≠ total 인 항목이 있으면 경고
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

  const loadExample = (key: keyof typeof EXAMPLES) => {
    setText(EXAMPLES[key].text);
    setCopied(false);
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
      // 클립보드 API 실패 시 폴백
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
      {/* 헤더 */}
      <header className="mb-6 text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-paper">
          <Receipt size={16} />
          split-receipt
        </div>
        <h1 className="text-xl font-bold text-ink">
          카톡 복붙 1/N 정산
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          휘갈겨 쓴 정산 메모를 붙여넣으면
          <br />
          최소 송금 경로를 영수증으로 정리해 드려요.
        </p>
      </header>

      {/* 입력 영역 */}
      <section className="mb-4">
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadExample("lodging")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-50 active:scale-95"
          >
            <Sparkles size={14} />
            예시: {EXAMPLES.lodging.label}
          </button>
          <button
            type="button"
            onClick={() => loadExample("multiRound")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-50 active:scale-95"
          >
            <Sparkles size={14} />
            예시: {EXAMPLES.multiRound.label}
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "예) 1차 고깃집 12만 철수결제 (철수, 영희, 민수)\n2차 볼링 4.5만 영희결제 (철수, 영희)\n택시비 1.5만 민수결제 (철수, 민수)"
          }
          rows={6}
          className="w-full resize-y rounded-xl border border-neutral-300 bg-white p-4 font-mono text-sm leading-relaxed text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-ink/10"
        />
        {text && (
          <button
            type="button"
            onClick={() => setText("")}
            className="mt-1 text-xs text-neutral-400 underline-offset-2 hover:underline"
          >
            지우기
          </button>
        )}
      </section>

      {/* 경고 */}
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

      {/* 결과 */}
      {result ? (
        <section>
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
          정산 메모를 입력하거나 예시를 불러오면
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
