"use client";

import { FormEvent, useState } from "react";
import { Plus, Users, X } from "lucide-react";
import { normalizePersonName } from "@/lib/people";

interface Props {
  people: string[];
  onChange: (people: string[]) => void;
}

export default function ParticipantStep({ people, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState("");

  const addName = (raw: string) => {
    const name = normalizePersonName(raw);
    if (!name) return;
    if (people.includes(name)) {
      setHint("이미 등록된 이름이에요.");
      setDraft("");
      return;
    }
    onChange([...people, name]);
    setDraft("");
    setHint("");
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    addName(draft);
  };

  const remove = (name: string) => {
    onChange(people.filter((p) => p !== name));
  };

  return (
    <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-paper">
          1
        </span>
        <Users size={16} />
        참여자 한 번만 등록
      </div>

      <form onSubmit={handleSubmit} className="mb-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (hint) setHint("");
          }}
          placeholder="이름"
          className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-ink px-3 py-2 text-xs font-semibold text-paper transition hover:opacity-90 active:scale-95 disabled:opacity-40"
        >
          <Plus size={14} />
          이름 추가
        </button>
      </form>

      {hint && <p className="mb-2 text-xs text-amber-700">{hint}</p>}

      {people.length === 0 ? (
        <p className="text-xs text-neutral-400">정산할 사람 이름을 추가해 주세요.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {people.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full bg-cream px-3 py-1.5 text-sm font-medium text-ink"
            >
              {name}
              <button
                type="button"
                aria-label={`${name} 삭제`}
                onClick={() => remove(name)}
                className="rounded-full p-0.5 text-neutral-400 transition hover:bg-white hover:text-ink"
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
