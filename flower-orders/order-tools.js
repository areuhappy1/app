(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlowerOrderTools = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function regionFromAddress(address) {
    // Only leading administrative address tokens; never infer a customer's home region.
    const tokens = String(address || '').trim().replace(/^(?:주소|배송지)\s*[:：]\s*/, '').split(/\s+/);
    const region = [];
    for (const token of tokens) {
      if (/^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/.test(token) ||
          /^[가-힣]{2,}(?:특별자치도|특별자치시|특별시|광역시|도|시|군|구|읍|면|동)$/.test(token)) region.push(token);
      else break;
      if (region.length === 3) break;
    }
    return region.join(' ');
  }
  const regionLabel = (o) => String(o.region || '').trim() || regionFromAddress(o.address);
  function dueAt(o) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '') || !/^\d{2}:\d{2}$/.test(o.time || '')) return null;
    const d = new Date(`${o.date}T${o.time}:00`);
    if (!Number.isFinite(+d)) return null;
    const [y, m, day] = o.date.split('-').map(Number);
    const [h, min] = o.time.split(':').map(Number);
    return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day && d.getHours() === h && d.getMinutes() === min ? +d : null;
  }
  function reminders(orders, now = Date.now(), lead = 60) {
    return orders.filter((o) => o.status !== 'done').map((o) => {
      const due = dueAt(o);
      const endOfDay = /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? +new Date(`${o.date}T23:59:59`) : null;
      let type, label;
      if ((due !== null && now >= due) || (due === null && endOfDay !== null && now > endOfDay)) {
        type = 'overdue'; label = '수령 시간이 지난 미완료 주문';
      } else if (due !== null && due - now <= lead * 60000) {
        type = 'soon'; label = `수령까지 ${Math.max(1, Math.ceil((due - now) / 60000))}분`;
      } else if (due === null) {
        type = 'missing'; label = '수령 날짜·시간을 확인해 주세요';
      } else if (o.status === 'new') {
        type = 'new'; label = '접수된 주문이 있어요';
      } else return null;
      return { key: JSON.stringify([o.id, type, o.date, o.time]), orderId: o.id, type, label, due, order: o };
    }).filter(Boolean).sort((a, b) => {
      const rank = { overdue: 0, soon: 1, missing: 2, new: 3 };
      return rank[a.type] - rank[b.type] || (a.due ?? Infinity) - (b.due ?? Infinity);
    });
  }
  function isVisible(alert, states, now = Date.now()) {
    const state = states[alert.key];
    return !state?.ack && !(state?.until > now);
  }
  function calendar(o, lead = 60, now = new Date()) {
    const due = dueAt(o);
    if (due === null) throw new Error('날짜와 시간을 먼저 입력해 주세요.');
    const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
    const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    // Fold by UTF-8 bytes, not code units (Korean event titles must remain valid).
    const fold = (line) => {
      let result = '', bytes = 0;
      for (const ch of line) {
        const size = new TextEncoder().encode(ch).length;
        if (bytes + size > 73) { result += '\r\n '; bytes = 1; }
        result += ch; bytes += size;
      }
      return result;
    };
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Flower Orders//KO', 'BEGIN:VEVENT',
      `UID:${esc(o.id)}@flower-orders`, `DTSTAMP:${utc(now)}`, `DTSTART:${utc(new Date(due))}`,
      `DTEND:${utc(new Date(due + 30 * 60000))}`,
      `SUMMARY:${esc(`${o.customer || '주문자 미정'} · ${o.product || '꽃 주문'}`)}`,
      `LOCATION:${esc(o.address || regionLabel(o))}`,
      `DESCRIPTION:${esc('꽃 주문함에서 최신 주문 내용을 확인해 주세요. 일정 변경·취소 시 캘린더도 직접 수정해 주세요.')}`,
      'BEGIN:VALARM', `TRIGGER:-PT${lead}M`, 'ACTION:DISPLAY', 'DESCRIPTION:꽃 주문 수령 준비',
      'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''].map(fold).join('\r\n');
  }
  return { regionFromAddress, regionLabel, dueAt, reminders, isVisible, calendar };
});
