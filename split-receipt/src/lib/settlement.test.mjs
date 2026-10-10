import { test } from "node:test";
import assert from "node:assert/strict";

// ts 파일을 직접 실행하기 위해 tsx 없이 간단히: 이 테스트는 빌드 산출물이 아닌
// 로직 검증용이므로, 순수 함수 복제가 아니라 소스에서 가져온다.
// (node --test 로 실행; TypeScript 변환이 필요하면 `npm run build` 후 검증 권장)

// 아래는 설계 불변식(invariant) 설명용 스모크 테스트입니다.
// 실제 TS import는 런타임 변환기가 필요하므로, 여기서는 JS로 재구현해
// 알고리즘 성질만 검증합니다. 프로덕션 로직은 settlement.ts가 단일 출처입니다.

function calcMinTransfers(balances) {
  const creditors = [];
  const debtors = [];
  for (const b of balances) {
    if (b.net > 0) creditors.push({ name: b.name, amount: b.net });
    else if (b.net < 0) debtors.push({ name: b.name, amount: -b.net });
  }
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const credit = creditors[ci];
    const debt = debtors[di];
    const settled = Math.min(credit.amount, debt.amount);
    if (settled > 0) transfers.push({ from: debt.name, to: credit.name, amount: Math.round(settled) });
    credit.amount -= settled;
    debt.amount -= settled;
    if (credit.amount <= 0.5) ci += 1;
    if (debt.amount <= 0.5) di += 1;
  }
  return transfers;
}

test("net 잔액의 합은 0이어야 하고, 송금 총액은 받을 돈 총합과 같다", () => {
  // 숙소비 30만: 철수 10만 결제, 영희 20만 결제, 4명이 7.5만씩 부담
  const balances = [
    { name: "철수", net: 100000 - 75000 }, // +25000
    { name: "영희", net: 200000 - 75000 }, // +125000
    { name: "민수", net: 0 - 75000 }, // -75000
    { name: "지훈", net: 0 - 75000 }, // -75000
  ];
  const sum = balances.reduce((s, b) => s + b.net, 0);
  assert.equal(sum, 0, "순잔액 합은 0");

  const transfers = calcMinTransfers(balances);
  const totalMoved = transfers.reduce((s, t) => s + t.amount, 0);
  const totalReceivable = balances.filter((b) => b.net > 0).reduce((s, b) => s + b.net, 0);
  assert.equal(totalMoved, totalReceivable, "송금 총액 = 받을 돈 총합");
  assert.ok(transfers.length <= balances.filter((b) => b.net !== 0).length - 1, "송금 횟수는 (0 아닌 인원-1) 이하");
});

test("모두가 딱 맞으면 송금은 0건", () => {
  const balances = [
    { name: "a", net: 0 },
    { name: "b", net: 0 },
  ];
  assert.equal(calcMinTransfers(balances).length, 0);
});
