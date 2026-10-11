"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Pencil, Plus, Receipt } from "lucide-react";
import { settle } from "@/lib/settlement";
import { formatWon } from "@/lib/format";
import type { SharePayload } from "@/lib/share";
import { shareReceiptImage } from "@/lib/shareActions";
import ReceiptCard from "@/components/ReceiptCard";
import TransferList from "@/components/TransferList";

interface Props {
  payload: SharePayload;
  onEdit: () => void;
  onNew: () => void;
}

/** 단톡방 링크로 들어온 친구가 보는 화면. 입력 없이 영수증 확인과 송금만 한다. */
export default function SharedView({ payload, onEdit, onNew }: Props) {
  const result = useMemo(() => settle(payload.expenses), [payload.expenses]);
  const [me, setMe] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const myBalance = me ? result.balances.find((b) => b.name === me) : undefined;
  const myTransfers = me ? result.transfers.filter((t) => t.from === me) : result.transfers;

  const handleSave = async () => {
    if (!cardRef.current) return;
    setSaving(true);
    try {
      const outcome = await shareReceiptImage(cardRef.current, payload.title);
      if (outcome === "failed") alert("이미지 저장에 실패했어요. 다시 시도해 주세요.");
    } catch (err) {
      console.error(err);
      alert("이미지 저장에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-8">
      <header className="mb-5 text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-paper">
          <Receipt size={16} />
          split-receipt
        </div>
        <h1 className="break-keep text-xl font-bold text-ink">
          {payload.title || "모임"} 정산이 도착했어요
        </h1>
        <p className="mt-1 text-sm text-neutral-500">앱 설치 없이 확인하고 토스로 바로 보내세요.</p>
      </header>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-ink">나는 누구?</div>
        <div className="flex flex-wrap gap-1.5">
          {result.people.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setMe((prev) => (prev === name ? null : name))}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition active:scale-95 ${
                me === name ? "bg-ink text-paper" : "bg-cream text-ink hover:bg-neutral-200"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        {myBalance && (
          <p className="mt-3 rounded-xl bg-cream px-3 py-2 text-sm text-ink">
            {myBalance.net < 0 ? (
              <>
                <b>{me}</b>님은 총 <b>{formatWon(-myBalance.net)}</b>을 보내면 돼요.
              </>
            ) : myBalance.net > 0 ? (
              <>
                <b>{me}</b>님은 <b>{formatWon(myBalance.net)}</b>을 받을 차례예요. 보낼 돈은 없어요.
              </>
            ) : (
              <>
                <b>{me}</b>님은 주고받을 돈이 없어요.
              </>
            )}
          </p>
        )}
      </section>

      <section className="mb-6">
        <div className="mb-2 text-sm font-semibold text-ink">
          {me ? "내가 보낼 돈" : "송금 목록"}
        </div>
        {me && myTransfers.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-center text-sm text-neutral-500">
            보낼 돈이 없어요 🎉
          </p>
        ) : (
          <TransferList transfers={myTransfers} accounts={payload.accounts} />
        )}
      </section>

      <section>
        <div className="mb-2 text-sm font-semibold text-ink">영수증</div>
        <ReceiptCard
          ref={cardRef}
          result={result}
          title={payload.title}
          accounts={payload.accounts}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-ink bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-neutral-50 active:scale-95 disabled:opacity-50"
        >
          <Download size={16} />
          {saving ? "만드는 중..." : "영수증 이미지 저장"}
        </button>
      </section>

      <div className="mt-8 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-3 text-xs font-semibold text-ink shadow-sm transition hover:bg-neutral-50 active:scale-95"
        >
          <Pencil size={14} />
          이 정산 고치기
        </button>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink px-3 py-3 text-xs font-semibold text-paper transition hover:opacity-90 active:scale-95"
        >
          <Plus size={14} />
          새 정산 만들기
        </button>
      </div>

      <footer className="mt-10 text-center text-[11px] text-neutral-400">
        정산 내용은 링크 안에만 담겨 있고 서버에 저장되지 않아요.
      </footer>
    </main>
  );
}
