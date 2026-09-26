const test = require('node:test');
const assert = require('node:assert/strict');
const { regionFromAddress, regionLabel, dueAt, reminders, isVisible, calendar } = require('./order-tools');
const order = { id: 'test-1', customer: '검수고객', status: 'new', date: '2026-09-27', time: '15:00' };
const time = (s) => +new Date(`2026-09-27T${s}:00`);

test('old orders derive a region; manual region takes precedence; venues are not invented as regions', () => {
  assert.equal(regionFromAddress('서울 강남구 역삼동 123'), '서울 강남구 역삼동');
  assert.equal(regionFromAddress('경기도 성남시 분당구 판교역로 1'), '경기도 성남시 분당구');
  assert.equal(regionFromAddress('서울아산병원 장례식장'), '');
  assert.equal(regionLabel({ region: '수원', address: '서울 강남구 역삼동 123' }), '수원');
  assert.equal(regionLabel({ address: '서울특별시 강남구 테헤란로 1' }), '서울특별시 강남구');
});
test('reminders progress from new to soon to overdue at exact boundaries', () => {
  assert.equal(reminders([order], time('13:59'))[0].type, 'new');
  assert.equal(reminders([order], time('14:00'))[0].type, 'soon');
  assert.equal(reminders([order], time('15:00'))[0].type, 'overdue');
  assert.equal(reminders([order], time('13:30'), 120)[0].type, 'soon');
});
test('completed and deleted orders do not leave active reminders', () => {
  assert.deepEqual(reminders([{ ...order, status: 'done' }], time('16:00')), []);
  assert.deepEqual(reminders([], time('16:00')), []);
  assert.deepEqual(reminders([{ ...order, status: 'making' }], time('12:00')), []);
});
test('acknowledging an order does not hide its later imminent or overdue alert', () => {
  const first = reminders([order], time('12:00'))[0];
  const states = { [first.key]: { ack: true } };
  assert.equal(isVisible(first, states), false);
  assert.equal(isVisible(reminders([order], time('14:00'))[0], states), true);
  const changed = reminders([{ ...order, time: '17:00' }], time('12:00'))[0];
  assert.equal(isVisible(changed, states), true);
});
test('snooze survives serialization and expires after exactly ten minutes', () => {
  const a = reminders([order], time('14:00'))[0];
  const states = JSON.parse(JSON.stringify({ [a.key]: { until: time('14:10') } }));
  assert.equal(isVisible(a, states, time('14:09')), false);
  assert.equal(isVisible(a, states, time('14:10')), true);
});
test('missing and invalid dates stay visible without inventing a pickup time', () => {
  assert.equal(dueAt({ date: '2026-02-30', time: '12:00' }), null);
  assert.equal(dueAt({ date: '2026-09-27', time: '24:00' }), null);
  assert.equal(reminders([{ ...order, time: '' }], time('12:00'))[0].type, 'missing');
  assert.equal(reminders([{ ...order, date: '2026-09-26', time: '' }], time('12:00'))[0].type, 'overdue');
});
test('calendar uses UTC, escaped text and UTF-8 folded lines with a reminder', () => {
  const text = calendar({ ...order, customer: '고객,이름;\n검수'.repeat(10) }, 60, new Date(time('12:00')));
  assert.ok(text.includes('TRIGGER:-PT60M'));
  assert.ok(text.includes(new Date(dueAt(order)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')));
  assert.ok(text.includes('고객\\,이름\\;\\n검수'));
  assert.ok(text.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
  assert.throws(() => calendar({ ...order, time: '' }), /날짜와 시간/);
});
