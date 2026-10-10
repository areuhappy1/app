import type { Expense } from "./types";
import { collectPeople } from "./settlement";

/** 이름 정규화: 공백 제거 + 끝의 '님/씨' 호칭 제거 */
export function normalizePersonName(name: string): string {
  return name.trim().replace(/[\s]/g, "").replace(/(님|씨)$/, "");
}

/** 등장 순서를 유지한 채 중복 없는 이름 목록으로 합친다. */
export function mergePeople(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const n = normalizePersonName(raw);
      if (n.length === 0 || seen.has(n)) continue;
      seen.add(n);
      order.push(n);
    }
  }
  return order;
}

/** 파싱된 지출에서 참여자 명단을 뽑아 기존 목록에 합친다. */
export function peopleFromExpenses(expenses: Expense[], existing: string[] = []): string[] {
  return mergePeople(existing, collectPeople(expenses));
}

/** 특정 이름을 지출 내역에서 제거한다. 결제자/참여자가 비면 항목 자체를 버린다. */
export function dropPersonFromExpenses(expenses: Expense[], name: string): Expense[] {
  return expenses
    .map((exp) => ({
      ...exp,
      payers: exp.payers.filter((p) => p.name !== name),
      participants: exp.participants.filter((p) => p !== name),
    }))
    .filter((exp) => exp.payers.length > 0 && exp.participants.length > 0);
}
