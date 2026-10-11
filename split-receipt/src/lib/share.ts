import type { BankAccount, Expense } from "./types";

/**
 * 공유 링크에 담는 정산 데이터.
 * 서버 없이 URL 해시(#s=...)에 넣어 전달하므로 해시는 서버로 전송되지 않는다.
 */
export interface SharePayload {
  title: string;
  people: string[];
  expenses: Expense[];
  accounts: Record<string, BankAccount>;
}

const VERSION = 1;
const HASH_KEY = "s";
const MAX_TEXT = 40;
const MAX_ITEMS = 200;

/*
 * 링크 길이를 줄이기 위해 이름은 people 배열의 인덱스로 참조한다.
 * { v, t, p: [이름], e: [[항목, 총액, [[결제자idx, 금액]], [참여자idx]]], a: [[idx, 은행, 계좌]] }
 */
type Compact = {
  v: number;
  t: string;
  p: string[];
  e: [string, number, [number, number][], number[]][];
  a: [number, string, string][];
};

export function encodeShare(payload: SharePayload): string {
  const people = [...payload.people];
  const indexOf = (name: string) => {
    let i = people.indexOf(name);
    if (i === -1) {
      people.push(name);
      i = people.length - 1;
    }
    return i;
  };

  const e: Compact["e"] = payload.expenses.map((exp) => [
    exp.title,
    exp.total,
    exp.payers.map((p) => [indexOf(p.name), p.amount] as [number, number]),
    exp.participants.map(indexOf),
  ]);
  const a: Compact["a"] = Object.entries(payload.accounts).map(([name, acc]) => [
    indexOf(name),
    acc.bank,
    acc.number,
  ]);

  const compact: Compact = { v: VERSION, t: payload.title, p: people, e, a };
  return toBase64Url(JSON.stringify(compact));
}

/** 신뢰할 수 없는 입력이므로 형식이 조금이라도 어긋나면 null */
export function decodeShare(encoded: string): SharePayload | null {
  try {
    const raw: unknown = JSON.parse(fromBase64Url(encoded));
    if (!isRecord(raw) || raw.v !== VERSION) return null;

    const people = asArray(raw.p).map((n) => asText(n)).filter((n) => n.length > 0);
    if (people.length === 0 || people.length > MAX_ITEMS) return null;
    const nameAt = (i: unknown) =>
      typeof i === "number" && Number.isInteger(i) && i >= 0 && i < people.length
        ? people[i]
        : null;

    const expenses: Expense[] = [];
    for (const item of asArray(raw.e).slice(0, MAX_ITEMS)) {
      const [title, total, payers, participants] = asArray(item);
      const amount = asAmount(total);
      if (!asText(title) || amount <= 0) return null;
      const exp: Expense = {
        title: asText(title),
        total: amount,
        payers: asArray(payers).flatMap((p) => {
          const [idx, paid] = asArray(p);
          const name = nameAt(idx);
          return name ? [{ name, amount: asAmount(paid) }] : [];
        }),
        participants: asArray(participants).flatMap((idx) => {
          const name = nameAt(idx);
          return name ? [name] : [];
        }),
      };
      if (exp.payers.length === 0 || exp.participants.length === 0) return null;
      expenses.push(exp);
    }
    if (expenses.length === 0) return null;

    const accounts: Record<string, BankAccount> = {};
    for (const item of asArray(raw.a)) {
      const [idx, bank, number] = asArray(item);
      const name = nameAt(idx);
      const digits = typeof number === "string" ? number.replace(/[^0-9]/g, "") : "";
      if (name && asText(bank) && digits) {
        accounts[name] = { bank: asText(bank), number: digits.slice(0, 20) };
      }
    }

    return { title: asText(raw.t), people, expenses, accounts };
  } catch {
    return null;
  }
}

export function buildShareUrl(baseUrl: string, payload: SharePayload): string {
  return `${baseUrl}#${HASH_KEY}=${encodeShare(payload)}`;
}

export function readShareFromHash(hash: string): SharePayload | null {
  const match = hash.match(new RegExp(`[#&]${HASH_KEY}=([A-Za-z0-9_-]+)`));
  return match ? decodeShare(match[1]) : null;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "";
}

function asAmount(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e11 ? Math.round(v) : 0;
}
