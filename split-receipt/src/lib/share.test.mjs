import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShareUrl, decodeShare, encodeShare, readShareFromHash } from "./share.ts";
import { buildTossLink, isUsableAccount } from "./toss.ts";

const payload = {
  title: "10월 강릉 여행",
  people: ["김민지", "이창석", "박서준"],
  expenses: [
    {
      title: "식당",
      total: 50000,
      payers: [{ name: "김민지", amount: 50000 }],
      participants: ["김민지", "이창석", "박서준"],
    },
    {
      title: "카페",
      total: 12000,
      payers: [{ name: "이창석", amount: 12000 }],
      participants: ["이창석", "박서준"],
    },
  ],
  accounts: { 김민지: { bank: "토스", number: "100012345678" } },
};

test("공유 링크로 인코딩한 정산은 그대로 복원된다", () => {
  const url = buildShareUrl("https://example.com/", payload);
  assert.match(url, /^https:\/\/example\.com\/#s=[A-Za-z0-9_-]+$/);
  assert.deepEqual(readShareFromHash(new URL(url).hash), payload);
});

test("깨졌거나 조작된 공유 데이터는 거부한다", () => {
  assert.equal(decodeShare("not-base64!!"), null);
  assert.equal(decodeShare(""), null);
  const tampered = encodeShare({
    ...payload,
    expenses: [{ ...payload.expenses[0], total: -1 }],
  });
  assert.equal(decodeShare(tampered), null);
});

test("공유 데이터의 계좌번호는 숫자만 남긴다", () => {
  const encoded = encodeShare({
    ...payload,
    accounts: { 김민지: { bank: "토스", number: "1000-1234-5678&x=1" } },
  });
  assert.equal(decodeShare(encoded).accounts["김민지"].number, "1000123456781");
});

test("토스 딥링크에 은행 코드·계좌·금액이 담긴다", () => {
  const acc = { bank: "카카오", number: "3333012345678" };
  assert.equal(
    buildTossLink(acc, 18667),
    "supertoss://send?amount=18667&bank=%EC%B9%B4%EC%B9%B4%EC%98%A4&accountNo=3333012345678&origin=qr"
  );
});

test("모르는 은행이나 짧은 계좌는 송금 버튼을 만들지 않는다", () => {
  assert.equal(isUsableAccount({ bank: "가짜은행", number: "1234567890" }), false);
  assert.equal(isUsableAccount({ bank: "국민", number: "1234" }), false);
  assert.equal(isUsableAccount({ bank: "국민", number: "12345678901" }), true);
});
