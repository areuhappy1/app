import type { Balance, Expense, SettlementResult, Transfer } from "./types";

/** 원 단위 반올림 (부동소수점 오차 방지용 보조) */
function roundWon(n: number): number {
  return Math.round(n);
}

/**
 * 지출 목록으로부터 개인별 순잔액을 계산한다.
 *  - paid: 개인이 실제로 결제한 총액
 *  - owed: 개인이 부담해야 할 총액 (각 지출을 참여자 수로 n분할)
 *  - net:  paid - owed
 *
 * 나눠떨어지지 않는 금액(예: 10000/3)은 1원 단위 오차를 참여자 순서대로
 * 앞사람부터 1원씩 더 부담시켜 "합계가 정확히 total"이 되도록 보정한다.
 */
export function computeBalances(expenses: Expense[], people: string[]): Balance[] {
  const paid: Record<string, number> = {};
  const owed: Record<string, number> = {};
  for (const p of people) {
    paid[p] = 0;
    owed[p] = 0;
  }

  for (const exp of expenses) {
    // 결제자가 낸 금액 누적
    for (const payer of exp.payers) {
      if (!(payer.name in paid)) {
        paid[payer.name] = 0;
        owed[payer.name] = 0;
      }
      paid[payer.name] += payer.amount;
    }

    // 참여자에게 균등 분할 (나머지는 앞사람부터 1원씩)
    const parts = exp.participants.filter((name) => name.length > 0);
    if (parts.length === 0) continue;
    const base = Math.floor(exp.total / parts.length);
    let remainder = exp.total - base * parts.length;
    for (const name of parts) {
      if (!(name in owed)) {
        paid[name] = paid[name] ?? 0;
        owed[name] = 0;
      }
      let share = base;
      if (remainder > 0) {
        share += 1;
        remainder -= 1;
      }
      owed[name] += share;
    }
  }

  const allNames = Object.keys(paid);
  return allNames.map((name) => {
    const net = roundWon(paid[name] - owed[name]);
    return { name, paid: roundWon(paid[name]), owed: roundWon(owed[name]), net };
  });
}

/**
 * 탐욕(Greedy) 알고리즘으로 송금 횟수를 최소화한다.
 *
 * 원리: 가장 많이 받을 사람(net 최대)과 가장 많이 보낼 사람(net 최소)을
 * 매번 매칭해 작은 쪽 금액만큼 상쇄한다. 매 단계마다 최소 한 명의 잔액이
 * 0이 되므로 송금 횟수는 (0이 아닌 사람 수 - 1) 이하로 유지된다.
 *
 * 100% 순수 함수 — 입력 balances를 변경하지 않는다.
 */
export function calculateMinTransfers(balances: Balance[]): Transfer[] {
  // net을 복사해서 작업 (원본 불변)
  const creditors: { name: string; amount: number }[] = [];
  const debtors: { name: string; amount: number }[] = [];

  for (const b of balances) {
    if (b.net > 0) creditors.push({ name: b.name, amount: b.net });
    else if (b.net < 0) debtors.push({ name: b.name, amount: -b.net });
  }

  // 큰 금액부터 처리하면 매칭이 빠르게 상쇄된다
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const credit = creditors[ci];
    const debt = debtors[di];
    const settled = Math.min(credit.amount, debt.amount);

    if (settled > 0) {
      transfers.push({ from: debt.name, to: credit.name, amount: roundWon(settled) });
    }

    credit.amount -= settled;
    debt.amount -= settled;

    // 1원 미만(부동소수점) 잔여는 0으로 간주하고 다음으로
    if (credit.amount <= 0.5) ci += 1;
    if (debt.amount <= 0.5) di += 1;
  }

  return transfers;
}

/** 전체 참여자 명단을 등장 순서대로(중복 제거) 수집 */
export function collectPeople(expenses: Expense[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const add = (name: string) => {
    const n = name.trim();
    if (n.length === 0 || seen.has(n)) return;
    seen.add(n);
    order.push(n);
  };
  for (const exp of expenses) {
    for (const payer of exp.payers) add(payer.name);
    for (const p of exp.participants) add(p);
  }
  return order;
}

/** 지출 목록 → 완전한 정산 결과 */
export function settle(expenses: Expense[]): SettlementResult {
  const people = collectPeople(expenses);
  const balances = computeBalances(expenses, people);
  const transfers = calculateMinTransfers(balances);
  const totalSpent = roundWon(expenses.reduce((sum, e) => sum + e.total, 0));
  const averagePerPerson = people.length > 0 ? roundWon(totalSpent / people.length) : 0;

  return {
    expenses,
    balances,
    transfers,
    people,
    totalSpent,
    averagePerPerson,
  };
}
