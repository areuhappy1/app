// 실행: node --test flower-orders/parser.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('./parser.js');

const now = new Date(2026, 8, 24, 18, 0); // 2026-09-24 (목)

test('PC 카톡 내보내기: 꽃다발 픽업 주문', () => {
  const text = `김민지 님과 카카오톡 대화
저장한 날짜 : 2026-09-24 18:20

--------------- 2026년 9월 24일 목요일 ---------------
[김민지] [오후 2:03] 안녕하세요! 꽃다발 주문하려고요
[김민지] [오후 2:03] 내일 오후 3시에 픽업 가능할까요?
[꽃집 봄날] [오후 2:05] 네 가능합니다 😊 예산이랑 원하시는 스타일 있으세요?
[김민지] [오후 2:06] 5만원 정도로 핑크톤 장미랑 수국 섞어서요
[김민지] [오후 2:06] 카드에 "생일 축하해 사랑해" 써주세요
[김민지] [오후 2:08] 입금했습니다 010-1234-5678 이에요`;
  const { format, candidates } = parse(text, { now });
  assert.equal(format, 'kakao');
  assert.equal(candidates.length, 1);
  const o = candidates[0];
  assert.equal(o.customer, '김민지');
  assert.equal(o.phone, '010-1234-5678');
  assert.equal(o.product, '꽃다발 ×1');
  assert.equal(o.price, 50000);
  assert.equal(o.date, '2026-09-25');
  assert.equal(o.time, '15:00');
  assert.equal(o.method, 'pickup');
  assert.equal(o.card, '생일 축하해 사랑해');
  assert.equal(o.paid, true);
  assert.match(o.style, /장미/);
  assert.match(o.style, /핑크톤/);
});

test('모바일 카톡 내보내기: 근조화환 배송, 세션 분리', () => {
  const text = `박상훈 님과 카카오톡 대화
2026년 9월 22일 오전 10:00, 박상훈 : 안녕하세요 꽃바구니 2개 금요일 오전 11시까지 가능할까요
2026년 9월 22일 오전 10:02, 박상훈 : 7만원짜리로요
2026년 9월 24일 오후 5:10, 박상훈 : 급하게 근조화환 하나 부탁드려요
2026년 9월 24일 오후 5:11, 박상훈 : 주소: 서울 송파구 올림픽로43길 88 서울아산병원 장례식장 3호실
2026년 9월 24일 오후 5:11, 박상훈 : 내일 아침 8시까지 도착해야해요
2026년 9월 24일 오후 5:12, 박상훈 : 리본에 "삼가 고인의 명복을 빕니다" 보내는 분: (주)한빛상사 임직원 일동`;
  const { candidates } = parse(text, { now });
  assert.equal(candidates.length, 2);

  const [a, b] = candidates;
  assert.equal(a.product, '꽃바구니 ×2');
  assert.equal(a.date, '2026-09-25'); // 9/22(화) 기준 금요일
  assert.equal(a.time, '11:00');
  assert.equal(a.price, 70000);

  assert.equal(b.product, '근조화환 ×1');
  assert.equal(b.method, 'delivery');
  assert.equal(b.date, '2026-09-25');
  assert.equal(b.time, '08:00');
  assert.match(b.address, /^서울 송파구 올림픽로43길 88/);
  assert.match(b.ribbon, /삼가 고인의 명복을 빕니다/);
  assert.equal(b.ribbon, '삼가 고인의 명복을 빕니다 / 보내는 분: (주)한빛상사 임직원 일동');
});

test('문자 붙여넣기: 받는 분·주소', () => {
  const text = `동양란 하나 개업선물로 보내주세요 10만원이요
9/28 오전 10시까지
받는분 이서준 010-9876-5432
경기 성남시 분당구 판교역로 235 3층
리본은 축 개업 / 보내는 분 김지현
주문자 김지현 010-2222-3333`;
  const { format, candidates } = parse(text, { now });
  assert.equal(format, 'text');
  assert.equal(candidates.length, 1);
  const o = candidates[0];
  assert.equal(o.customer, '김지현');
  assert.equal(o.phone, '010-2222-3333');
  assert.equal(o.recipient, '이서준');
  assert.equal(o.recipientPhone, '010-9876-5432');
  assert.equal(o.product, '동양란 ×1');
  assert.equal(o.price, 100000);
  assert.equal(o.date, '2026-09-28');
  assert.equal(o.time, '10:00');
  assert.equal(o.method, 'delivery');
  assert.equal(o.address, '경기 성남시 분당구 판교역로 235 3층');
  assert.match(o.ribbon, /축 개업/);
});

test('문자 여러 건: 빈 줄 두 개로 구분하고 주문 아닌 글은 제외', () => {
  const text = `토요일 2시 꽃다발 3만원 픽업할게요


감사합니다~


화분 2개 다음주 월요일 배송 부탁드려요`;
  const { candidates } = parse(text, { now });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].date, '2026-09-26');
  assert.equal(candidates[0].time, '14:00');
  assert.equal(candidates[1].product, '화분 ×2');
  assert.equal(candidates[1].date, '2026-09-28');
});

test('가게가 보낸 말만 있는 대화는 주문으로 잡지 않음', () => {
  const text = `[꽃집 봄날] [오후 1:00] 이번 주 꽃다발 할인 이벤트! 3만원
[손님] [오후 1:05] 감사합니다`;
  const { candidates } = parse(text, { now, shopName: '꽃집 봄날' });
  assert.equal(candidates.length, 0);
});
