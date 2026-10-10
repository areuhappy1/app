"use client";

import { useState } from "react";
import { ClipboardPaste, Sparkles } from "lucide-react";
import { parseMemo } from "@/lib/parser";
import { EXAMPLES } from "@/lib/examples";
import type { Expense } from "@/lib/types";

interface Props {
  onApply: (expenses: Expense[]) => void;
}

export default function AutoFillPanel({ onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");

  const applyText = (raw: string) => {
    const expenses = parseMemo(raw);
    if (expenses.length === 0) {
      setHint("지출 항목을 찾지 못했어요. 한 줄에 항목·금액·낸 사람을 넣어 주세요.");
      return;
    }
    onApply(expenses);
    setText("");
    setHint(`${expenses.length}건을 채웠어요. 아래 참여자·지출을 확인해 주세요.`);
    setOpen(false);
  };

  return (
    <section className="mb-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-dashed border-neutral-300 bg-white/70 px-3 py-2.5 text-left text-sm text-ink"
      >
        <span className="inline-flex items-center gap-2 font-medium">
          <ClipboardPaste size={15} />
          카톡·메모 자동 채우기
        </span>
        <span className="text-xs text-neutral-400">{open ? "닫기" : "열기"}</span>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-neutral-200 bg-white p-3">
          <p className="mb-2 text-xs text-neutral-500">
            카톡 복붙이나 OCR로 뽑은 텍스트를 붙여넣으면 참여자와 지출을 채워 드려요.
          </p>
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyText(EXAMPLES.lodging.text)}
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-ink hover:bg-neutral-50"
            >
              <Sparkles size={12} />
              예시: {EXAMPLES.lodging.label}
            </button>
            <button
              type="button"
              onClick={() => applyText(EXAMPLES.multiRound.text)}
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-ink hover:bg-neutral-50"
            >
              <Sparkles size={12} />
              예시: {EXAMPLES.multiRound.label}
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (hint) setHint("");
            }}
            rows={4}
            placeholder={
              "예) 1차 고깃집 12만 철수결제 (철수, 영희, 민수)\n2차 볼링 4.5만 영희결제 (철수, 영희)"
            }
            className="w-full resize-y rounded-xl border border-neutral-300 bg-white p-3 font-mono text-xs leading-relaxed text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          />
          <button
            type="button"
            onClick={() => applyText(text)}
            className="mt-2 w-full rounded-xl border-2 border-ink bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-neutral-50"
          >
            참여자·지출로 채우기
          </button>
          {hint && <p className="mt-2 text-xs text-neutral-500">{hint}</p>}
        </div>
      )}
    </section>
  );
}
