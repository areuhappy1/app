(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const { ymd } = FlowerParser;

  // ---------- 저장소 ----------
  const ORDERS_KEY = 'flower-orders.v1';
  const SETTINGS_KEY = 'flower-orders.settings.v1';
  const load = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const store = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };

  let orders = load(ORDERS_KEY, []);
  let settings = load(SETTINGS_KEY, { shopName: '', chatName: '' });
  let candidates = [];
  let view = { filter: 'upcoming', query: '', hideDone: true };

  const saveOrders = () => {
    if (!store(ORDERS_KEY, orders)) toast('⚠️ 저장하지 못했어요. 백업 파일을 저장해 두세요.');
  };

  // ---------- 서버 연결 (카톡·문자 자동 수집) ----------
  const API_BASE = 'https://aqknqsweeasqlqreqvxk.supabase.co/functions/v1/flower';
  const SERVER_KEY = 'flower-orders.server-key';
  let serverKey = load(SERVER_KEY, '');
  let inboxMessages = [];
  const remote = () => Boolean(serverKey);
  if (remote()) orders = [];

  async function api(path, { method = 'GET', body, key = serverKey } = {}) {
    const res = await fetch(API_BASE + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-flower-key': key },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('매장 비밀번호가 맞지 않아요.');
    if (!res.ok) throw new Error(data.error || `서버 오류 (${res.status})`);
    return data;
  }

  const META = ['id', 'status', 'createdAt', 'updatedAt'];
  const orderData = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !META.includes(k)));
  const fromRow = (r) => ({ ...r.data, id: r.id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });

  async function createOrder(data, messageIds = [], status = 'new') {
    if (remote()) {
      const { order } = await api('/orders', { method: 'POST', body: { order: data, status, messageIds } });
      orders.push(fromRow(order));
    } else {
      const now = new Date().toISOString();
      orders.push({ ...data, id: uid(), status, createdAt: now, updatedAt: now });
      saveOrders();
    }
  }

  async function updateOrder(o) {
    o.updatedAt = new Date().toISOString();
    if (remote()) await api(`/orders/${o.id}`, { method: 'PATCH', body: { order: orderData(o), status: o.status } });
    else saveOrders();
  }

  async function deleteOrder(o) {
    if (remote()) await api(`/orders/${o.id}`, { method: 'DELETE' });
    orders = orders.filter((x) => x !== o);
    if (!remote()) saveOrders();
  }

  let syncing = false;
  let lastSync = null;
  async function sync({ quiet = true } = {}) {
    if (!remote() || syncing) return;
    syncing = true;
    try {
      const [o, m] = await Promise.all([api('/orders'), api('/messages')]);
      orders = o.orders.map(fromRow);
      inboxMessages = m.messages;
      lastSync = new Date();
      setConn('ok');
      render();
      renderInbox();
    } catch (e) {
      setConn('error');
      if (!quiet) toast(`⚠️ ${e.message}`);
    } finally {
      syncing = false;
    }
  }

  function fail(e) {
    toast(`⚠️ 저장하지 못했어요. ${e.message || ''}`);
    sync();
  }

  function setConn(state) {
    const el = $('#conn');
    el.dataset.state = state;
    el.textContent = state === 'ok' ? '● 자동 수집 중' : state === 'error' ? '⚠︎ 연결 끊김' : '이 기기에만 저장';
  }

  const STATUSES = [
    ['new', '접수'],
    ['making', '제작중'],
    ['ready', '준비완료'],
    ['done', '완료'],
  ];
  const statusLabel = (s) => (STATUSES.find(([k]) => k === s) || STATUSES[0])[1];
  const nextStatus = (s) => STATUSES[(STATUSES.findIndex(([k]) => k === s) + 1) % STATUSES.length][0];

  // ---------- 도우미 ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = (n) => (n || n === 0 ? `${Number(n).toLocaleString('ko-KR')}원` : '');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const hash = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
  };
  const today = () => ymd(new Date());
  const shiftDay = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  const DOW = '일월화수목금토';

  function dayLabel(date) {
    if (!date) return '날짜 미정';
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const rel = { [today()]: '오늘', [shiftDay(1)]: '내일', [shiftDay(2)]: '모레', [shiftDay(-1)]: '어제' }[date];
    const year = y !== new Date().getFullYear() ? `${y}년 ` : '';
    return `${year}${m}월 ${d}일 (${DOW[dt.getDay()]})${rel ? ` · ${rel}` : ''}`;
  }

  function timeLabel(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(m).padStart(2, '0')}`;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- 주문 입력 폼 ----------
  function field(name, label, value, { type = 'text', wide = false, placeholder = '', inputmode = '' } = {}) {
    return `<label class="field${wide ? ' wide' : ''}"><span class="label">${label}</span>
      <input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"${inputmode ? ` inputmode="${inputmode}"` : ''} autocomplete="off"></label>`;
  }

  function formHTML(o, openSource = false) {
    const missing = (v) => (v ? '' : ' missing');
    return `
      <div class="form-grid">
        ${field('customer', '고객명', o.customer)}
        ${field('phone', '연락처', o.phone, { type: 'tel', placeholder: '예: 010-1234-5678' })}
        <label class="field wide${missing(o.product)}"><span class="label">상품</span>
          <input name="product" value="${esc(o.product)}" placeholder="예: 꽃다발 ×1, 동양란 ×1" autocomplete="off"></label>
        ${field('price', '금액(원)', o.price ?? '', { inputmode: 'numeric', placeholder: '예: 50000' })}
        ${field('style', '꽃·색감', o.style, { placeholder: '예: 장미, 핑크톤' })}
        <label class="field${missing(o.date)}"><span class="label">날짜</span>
          <input name="date" type="date" value="${esc(o.date)}"></label>
        ${field('time', '시간', o.time, { type: 'time' })}
        <div class="field wide"><span class="label">수령 방법</span>
          <div class="seg">
            <label><input type="radio" name="method" value="pickup"${o.method === 'pickup' ? ' checked' : ''}> 🛍️ 픽업</label>
            <label><input type="radio" name="method" value="delivery"${o.method === 'delivery' ? ' checked' : ''}> 🚚 배송</label>
          </div>
        </div>
        <div class="delivery-only wide form-grid">
          ${field('address', '배송지', o.address, { wide: true, placeholder: '주소 또는 장례식장·병원 이름' })}
          ${field('recipient', '받는 분', o.recipient)}
          ${field('recipientPhone', '받는 분 연락처', o.recipientPhone, { type: 'tel' })}
        </div>
        ${field('ribbon', '리본 문구', o.ribbon, { wide: true, placeholder: '예: 축 개업 / 보내는 분: OOO' })}
        ${field('card', '카드 문구', o.card, { wide: true })}
        <label class="field wide"><span class="label">메모</span>
          <textarea name="memo" rows="2" placeholder="요청사항">${esc(o.memo)}</textarea></label>
        <label class="check wide"><input type="checkbox" name="paid"${o.paid ? ' checked' : ''}> 💰 입금 확인</label>
      </div>
      ${o.source ? `<details class="source"${openSource ? ' open' : ''}><summary>원본 대화 보기</summary><pre>${esc(o.source)}</pre></details>` : ''}`;
  }

  function bindMethodToggle(form) {
    const sync = () => { form.dataset.method = (form.querySelector('input[name=method]:checked') || {}).value || ''; };
    form.addEventListener('change', (e) => { if (e.target.name === 'method') sync(); });
    sync();
  }

  function readForm(form, base) {
    const fd = new FormData(form);
    const get = (k) => (fd.get(k) || '').toString().trim();
    const price = get('price').replace(/[^\d]/g, '');
    return {
      ...base,
      customer: get('customer'),
      phone: get('phone'),
      product: get('product'),
      price: price ? Number(price) : null,
      style: get('style'),
      date: get('date'),
      time: get('time'),
      method: get('method'),
      address: get('address'),
      recipient: get('recipient'),
      recipientPhone: get('recipientPhone'),
      ribbon: get('ribbon'),
      card: get('card'),
      memo: get('memo'),
      paid: fd.get('paid') === 'on',
    };
  }

  // ---------- 탭 ----------
  function showTab(name) {
    $$('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
    window.scrollTo(0, 0);
    if (name === 'add' && !candidates.length) setTimeout(() => paste.focus(), 0);
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ---------- 주문 목록 ----------
  function matchesFilter(o) {
    const t = today();
    switch (view.filter) {
      case 'today': return o.date === t;
      case 'tomorrow': return o.date === shiftDay(1);
      case 'week': return o.date >= t && o.date <= shiftDay(6);
      case 'upcoming': return !o.date || o.date >= t;
      case 'past': return o.date && o.date < t;
      default: return true;
    }
  }

  function matchesQuery(o) {
    if (!view.query) return true;
    const q = view.query.toLowerCase().replace(/-/g, '');
    return [o.customer, o.phone, o.product, o.address, o.recipient, o.recipientPhone, o.ribbon, o.memo, o.style]
      .join(' ').toLowerCase().replace(/-/g, '').includes(q);
  }

  const sortKey = (o) => `${o.date || '9999-99-99'} ${o.time || '99:99'}`;

  function tally(list) {
    const counts = new Map();
    for (const o of list) {
      for (const part of (o.product || '').split(',')) {
        const m = part.trim().match(/^(.+?)\s*[×x*]\s*(\d+)$/);
        const name = (m ? m[1] : part).trim();
        if (name) counts.set(name, (counts.get(name) || 0) + (m ? +m[2] : 1));
      }
    }
    return [...counts].map(([n, c]) => `${n} ${c}`).join(' · ');
  }

  function orderCard(o) {
    const method = o.method === 'delivery' ? '<span class="badge delivery">🚚 배송</span>' : o.method === 'pickup' ? '<span class="badge pickup">🛍️ 픽업</span>' : '';
    const tel = (p) => `<a href="tel:${esc(p.replace(/[^\d+]/g, ''))}">${esc(p)}</a>`;
    const lines = [];
    const who = [esc(o.customer) || '이름 없음', o.phone ? tel(o.phone) : ''].filter(Boolean).join(' · ');
    lines.push(`<div class="meta">👤 ${who}</div>`);
    if (o.method === 'delivery' && (o.address || o.recipient)) {
      const to = [o.recipient ? `${esc(o.recipient)}님` : '', o.recipientPhone ? tel(o.recipientPhone) : ''].filter(Boolean).join(' ');
      lines.push(`<div class="meta">📍 ${esc(o.address) || '주소 미정'}${to ? ` → ${to}` : ''}</div>`);
    }
    if (o.style) lines.push(`<div class="meta">🌷 ${esc(o.style)}</div>`);
    if (o.ribbon) lines.push(`<div class="meta">🎀 ${esc(o.ribbon)}</div>`);
    if (o.card) lines.push(`<div class="meta">💌 ${esc(o.card)}</div>`);
    if (o.memo) lines.push(`<div class="meta">📝 ${esc(o.memo)}</div>`);

    return `
      <li class="order status-${o.status}" data-id="${o.id}">
        <div class="when">${o.time ? `<strong>${timeLabel(o.time)}</strong>` : '<span class="muted">시간 미정</span>'}</div>
        <div class="body">
          <div class="head">
            <span class="product">${esc(o.product) || '<span class="muted">상품 미정</span>'}</span>
            ${method}
            ${o.price ? `<span class="price">${won(o.price)}</span>` : ''}
            ${o.paid ? '<span class="badge paid">입금</span>' : ''}
          </div>
          ${lines.join('')}
          <div class="actions">
            <button type="button" class="status-btn" data-act="status" title="눌러서 다음 단계로">${statusLabel(o.status)} ▸</button>
            <button type="button" class="btn small" data-act="copy">확인 메시지 복사</button>
            <button type="button" class="btn small ghost" data-act="edit">수정</button>
          </div>
        </div>
      </li>`;
  }

  function render() {
    const t = today();
    const active = orders.filter((o) => o.status !== 'done');
    $('#tab-count').textContent = active.filter((o) => !o.date || o.date >= t).length || '';
    $('[data-count=today]').textContent = active.filter((o) => o.date === t).length || '';
    $('[data-count=tomorrow]').textContent = active.filter((o) => o.date === shiftDay(1)).length || '';
    $('#brand-name').textContent = settings.shopName ? `${settings.shopName} 주문함` : '꽃 주문함';

    const list = orders
      .filter(matchesFilter)
      .filter(matchesQuery)
      .filter((o) => !view.hideDone || o.status !== 'done')
      .sort((a, b) => (view.filter === 'past' ? sortKey(b).localeCompare(sortKey(a)) : sortKey(a).localeCompare(sortKey(b))));

    const groups = new Map();
    for (const o of list) {
      if (!groups.has(o.date)) groups.set(o.date, []);
      groups.get(o.date).push(o);
    }

    $('#order-list').innerHTML = [...groups].map(([date, items]) => {
      const delivery = items.filter((o) => o.method === 'delivery').length;
      const pickup = items.filter((o) => o.method === 'pickup').length;
      const sum = items.reduce((s, o) => s + (o.price || 0), 0);
      const stats = [`${items.length}건`, delivery ? `배송 ${delivery}` : '', pickup ? `픽업 ${pickup}` : '', sum ? won(sum) : ''].filter(Boolean).join(' · ');
      const products = tally(items);
      return `
        <section class="day${date === t ? ' is-today' : ''}">
          <header class="day-head">
            <h3>${dayLabel(date)}</h3>
            <p class="day-stats">${stats}</p>
            ${products ? `<p class="day-products">${esc(products)}</p>` : ''}
          </header>
          <ul class="orders">${items.map(orderCard).join('')}</ul>
        </section>`;
    }).join('');

    const empty = $('#empty');
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.innerHTML = orders.length
        ? '조건에 맞는 주문이 없어요.'
        : '아직 주문이 없어요.<br><b>＋ 주문 넣기</b>에서 카톡 대화나 문자를 붙여넣어 보세요.';
    }
  }

  $('#filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    view.filter = chip.dataset.filter;
    $$('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    render();
  });
  $('#search').addEventListener('input', (e) => { view.query = e.target.value.trim(); render(); });
  $('#hide-done').addEventListener('change', (e) => { view.hideDone = e.target.checked; render(); });

  $('#order-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.order').dataset.id;
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    if (btn.dataset.act === 'status') {
      o.status = nextStatus(o.status);
      render();
      updateOrder(o).then(() => toast(`${o.customer || '주문'} → ${statusLabel(o.status)}`), fail);
    } else if (btn.dataset.act === 'copy') {
      copyText(confirmMessage(o)).then((ok) => toast(ok ? '확인 메시지를 복사했어요. 카톡에 붙여넣으세요.' : '복사하지 못했어요.'));
    } else if (btn.dataset.act === 'edit') {
      openEditor(o);
    }
  });

  // ---------- 확인 메시지 ----------
  function confirmMessage(o) {
    const lines = [`[${settings.shopName || '꽃집'}] 주문 확인드립니다 💐`];
    if (o.product) lines.push(`· 상품: ${o.product}`);
    if (o.style) lines.push(`· 스타일: ${o.style}`);
    const when = [o.date ? dayLabel(o.date).replace(/ · .*$/, '') : '', timeLabel(o.time)].filter(Boolean).join(' ');
    const how = o.method === 'delivery' ? '배송' : o.method === 'pickup' ? '픽업' : '';
    if (when || how) lines.push(`· 일시: ${[when, how].filter(Boolean).join(' ')}`);
    if (o.method === 'delivery') {
      if (o.address) lines.push(`· 배송지: ${o.address}`);
      if (o.recipient) lines.push(`· 받는 분: ${o.recipient}${o.recipientPhone ? ` (${o.recipientPhone})` : ''}`);
    }
    if (o.ribbon) lines.push(`· 리본: ${o.ribbon}`);
    if (o.card) lines.push(`· 카드: ${o.card}`);
    if (o.price) lines.push(`· 금액: ${won(o.price)}${o.paid ? ' (입금 확인)' : ''}`);
    lines.push('내용이 맞는지 확인 부탁드려요. 감사합니다!');
    return lines.join('\n');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // ---------- 수정 창 ----------
  const editDialog = $('#edit-dialog');
  const editForm = $('#edit-form');
  let editing = null;

  function openEditor(o) {
    editing = o;
    editForm.innerHTML = `
      <h2>주문 수정</h2>
      ${formHTML(o)}
      <div class="row-actions end">
        <button type="button" class="btn danger ghost" data-act="delete">삭제</button>
        <span class="grow"></span>
        <button value="cancel" class="btn">취소</button>
        <button value="save" class="btn primary">저장</button>
      </div>`;
    bindMethodToggle(editForm);
    editDialog.returnValue = '';
    editDialog.showModal();
  }

  editForm.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act=delete]');
    if (!btn || !editing) return;
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = '한 번 더 누르면 삭제';
      return;
    }
    const target = editing;
    editDialog.close('deleted');
    deleteOrder(target).then(() => { render(); toast('주문을 삭제했어요.'); }, fail);
  });

  editDialog.addEventListener('close', () => {
    if (editDialog.returnValue === 'save' && editing) {
      const o = Object.assign(editing, readForm(editForm, {}));
      render();
      updateOrder(o).then(() => toast('저장했어요.'), fail);
    }
    editing = null;
  });

  // ---------- 붙여넣기 → 후보 ----------
  const paste = $('#paste');

  function runParse() {
    const text = paste.value.trim();
    if (!text) { toast('먼저 대화나 문자를 붙여넣어 주세요.'); return; }
    const { format, candidates: found } = FlowerParser.parse(text, { shopName: settings.chatName });
    candidates = found.map((c) => ({ ...c, key: hash(c.source || '') }));
    renderCandidates(format);
    if (!found.length) toast('주문으로 보이는 내용을 못 찾았어요. 직접 입력해 주세요.');
  }

  function renderCandidates(format) {
    const head = $('#candidates-head');
    head.hidden = candidates.length === 0;
    $('#candidates-summary').textContent = candidates.length
      ? `${format === 'kakao' ? '카톡 대화' : '입력한 글'}에서 주문 ${candidates.length}건을 찾았어요. 확인 후 등록하세요.`
      : '';
    $('#save-all-btn').hidden = candidates.length < 2;
    $('#candidates').innerHTML = candidates.map((c, i) => {
      const dup = c.source && orders.some((o) => o.key === c.key);
      return `
        <form class="card cand order-form" data-index="${i}">
          <div class="cand-title">
            <strong>주문 ${candidates.length > 1 ? `${i + 1}/${candidates.length}` : ''}</strong>
            ${dup ? '<span class="badge warn">이미 등록된 대화예요</span>' : ''}
          </div>
          ${formHTML(c)}
          <div class="row-actions end">
            <button type="button" class="btn ghost" data-act="skip">건너뛰기</button>
            <button type="submit" class="btn primary">등록</button>
          </div>
        </form>`;
    }).join('');
    $$('#candidates form').forEach(bindMethodToggle);
    if (candidates.length) $('#candidates-head').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function takeCandidate(form, save) {
    const i = Number(form.dataset.index);
    if (save) await createOrder(readForm(form, { source: candidates[i].source, key: candidates[i].key, receivedAt: candidates[i].receivedAt }));
    form.remove();
    if (!$('#candidates form')) {
      $('#candidates-head').hidden = true;
      candidates = [];
      if (save) {
        paste.value = '';
        showTab('list');
      }
    }
  }

  $('#candidates').addEventListener('submit', (e) => {
    e.preventDefault();
    takeCandidate(e.target, true).then(() => { render(); toast('주문을 등록했어요 🌸'); }, fail);
  });
  $('#candidates').addEventListener('click', (e) => {
    if (e.target.dataset.act === 'skip') takeCandidate(e.target.closest('form'), false);
  });
  $('#save-all-btn').addEventListener('click', async () => {
    const forms = $$('#candidates form');
    try {
      for (const f of forms) await takeCandidate(f, true);
      render();
      toast(`주문 ${forms.length}건을 등록했어요 🌸`);
    } catch (e) {
      fail(e);
    }
  });

  $('#parse-btn').addEventListener('click', runParse);
  $('#manual-btn').addEventListener('click', () => {
    candidates = [{ customer: '', phone: '', product: '', price: null, style: '', date: today(), time: '', method: '', address: '', recipient: '', recipientPhone: '', ribbon: '', card: '', memo: '', paid: false, source: '', key: '' }];
    renderCandidates('manual');
    $('#candidates-summary').textContent = '새 주문을 입력하세요.';
  });

  $('#clipboard-btn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { toast('클립보드가 비어 있어요.'); return; }
      paste.value = text;
      runParse();
    } catch {
      paste.focus();
      toast('입력칸을 길게 눌러 붙여넣기 해주세요.');
    }
  });

  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    paste.value = await file.text();
    runParse();
  });

  // ---------- 사진에서 글자 읽기 ----------
  // Tesseract.js로 브라우저 안에서 읽습니다. 사진은 서버로 보내지 않습니다.
  // 처음 한 번은 한국어 글자 인식 파일(약 10MB)을 받아야 해서 조금 걸립니다.
  const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let ocrWorker = null;
  let ocrProgress = () => {};

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('글자 인식 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));
      document.head.appendChild(s);
    });
  }

  async function getOcr() {
    if (!window.Tesseract) await loadScript(TESSERACT_SRC);
    if (!ocrWorker) ocrWorker = await Tesseract.createWorker(['kor', 'eng'], 1, { logger: (m) => ocrProgress(m) });
    return ocrWorker;
  }

  // 글자 인식이 한글 사이에 띄어쓰기를 넣는 경우("꽃 다 발")를 붙여 줍니다.
  function tidyOcr(text) {
    return text
      .split('\n')
      .map((line) => {
        const tokens = line.trim().split(/\s+/);
        const single = tokens.filter((t) => /^[가-힣]$/.test(t)).length;
        return tokens.length > 3 && single / tokens.length > 0.5 ? line.replace(/(?<=[가-힣])\s+(?=[가-힣])/g, '') : line;
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // 카톡 캡처처럼 색 배경 위 말풍선 글자는 그대로 읽으면 놓치기 쉬워서,
  // 글자만 검게 남기는 흑백 이미지로 바꾸고 작은 이미지는 2배로 키웁니다. 어두운 화면은 뒤집습니다.
  async function prepareImage(file) {
    const bmp = await createImageBitmap(file);
    const scale = bmp.width < 1000 ? 2 : 1;
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width * scale;
    canvas.height = bmp.height * scale;
    const g = canvas.getContext('2d');
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const n = d.length / 4;
    const lum = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      sum += lum[i];
    }
    const dark = sum / n < 110;
    for (let i = 0; i < n; i++) {
      const l = dark ? 255 - lum[i] : lum[i];
      const v = l < 140 ? 0 : 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }

  const hangulCount = (t) => (t.match(/[가-힣]/g) || []).length;

  // 흑백 처리한 이미지로 먼저 읽고, 글자가 거의 없으면 원본으로도 읽어 더 많이 읽힌 쪽을 씁니다.
  async function recognize(worker, file) {
    let text = '';
    try {
      text = (await worker.recognize(await prepareImage(file))).data.text;
    } catch { /* 이미지 변환이 안 되는 브라우저는 원본으로 읽습니다 */ }
    if (hangulCount(text) < 10) {
      const raw = (await worker.recognize(file)).data.text;
      if (hangulCount(raw) > hangulCount(text)) text = raw;
    }
    return text;
  }

  async function readImages(files) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    const status = $('#ocr-status');
    status.hidden = false;
    const texts = [];
    try {
      for (let i = 0; i < images.length; i++) {
        const label = images.length > 1 ? `사진 ${i + 1}/${images.length} · ` : '';
        status.textContent = `${label}글자 인식 준비 중… (처음 한 번은 1분 정도 걸릴 수 있어요)`;
        ocrProgress = (m) => {
          if (m.status === 'recognizing text') status.textContent = `${label}글자 읽는 중… ${Math.round(m.progress * 100)}%`;
        };
        const worker = await getOcr();
        texts.push(tidyOcr(await recognize(worker, images[i])));
      }
    } catch (e) {
      status.hidden = true;
      toast(`⚠️ ${e.message || '사진을 읽지 못했어요.'}`);
      return;
    }
    status.hidden = true;
    const found = texts.filter(Boolean);
    if (!found.length) { toast('사진에서 글자를 찾지 못했어요.'); return; }
    // 사진마다 --- 줄로 나눠 따로 주문을 찾습니다. 한 주문이 사진 여러 장이면 --- 줄을 지우고 다시 찾으면 돼요.
    paste.value = found.join('\n---\n');
    runParse();
    toast(found.length > 1
      ? '사진마다 따로 정리했어요. 한 주문이 여러 장이면 --- 줄을 지우고 다시 "주문 찾기"를 누르세요.'
      : '사진의 글자를 읽었어요. 틀린 글자는 고쳐 주세요.');
  }

  $('#image-input').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    readImages(files);
  });

  // PC에서 캡처 이미지를 바로 붙여넣거나 끌어다 놓아도 읽습니다.
  // 붙여넣으면 바로 주문을 찾아 정리합니다 (버튼을 누를 필요 없음).
  paste.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); readImages(files); return; }
    setTimeout(() => { if (paste.value.trim()) runParse(); }, 0);
  });
  paste.addEventListener('dragover', (e) => e.preventDefault());
  paste.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); readImages(files); }
  });

  $('#sample-btn').addEventListener('click', () => {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x; };
    const line = (x) => `--------------- ${x.getFullYear()}년 ${x.getMonth() + 1}월 ${x.getDate()}일 ${DOW[x.getDay()]}요일 ---------------`;
    const shop = settings.chatName || '꽃집 봄날';
    paste.value = [
      '김민지 님과 카카오톡 대화',
      line(d(-2)),
      '[김민지] [오후 2:03] 안녕하세요! 꽃다발 주문하려고요',
      '[김민지] [오후 2:03] 모레 오후 3시에 픽업 가능할까요?',
      `[${shop}] [오후 2:05] 네 가능합니다 😊 예산이랑 원하시는 스타일 있으세요?`,
      '[김민지] [오후 2:06] 5만원 정도로 핑크톤 장미랑 수국 섞어서요',
      '[김민지] [오후 2:06] 카드에 "생일 축하해 사랑해" 써주세요',
      '[김민지] [오후 2:08] 입금했습니다 010-1234-5678 이에요',
      line(d(0)),
      '[김민지] [오전 9:12] 사장님 회사에 근조화환 하나 급하게 부탁드려요',
      '[김민지] [오전 9:13] 주소: 서울 송파구 올림픽로43길 88 서울아산병원 장례식장 3호실',
      '[김민지] [오전 9:13] 내일 아침 8시까지 도착해야 해요',
      '[김민지] [오전 9:14] 리본에 "삼가 고인의 명복을 빕니다" 보내는 분: (주)한빛상사 임직원 일동',
      '[김민지] [오전 9:15] 10만원 맞으시죠?',
    ].join('\n');
    runParse();
  });

  // ---------- 설정·백업 ----------
  const settingsDialog = $('#settings-dialog');
  const settingsForm = $('#settings-form');
  $('#settings-btn').addEventListener('click', () => {
    settingsForm.shopName.value = settings.shopName || '';
    settingsForm.chatName.value = settings.chatName || '';
    settingsForm.serverKey.value = serverKey;
    renderServerStatus();
    settingsDialog.returnValue = '';
    settingsDialog.showModal();
  });
  settingsDialog.addEventListener('close', () => {
    if (settingsDialog.returnValue !== 'save') return;
    settings = { shopName: settingsForm.shopName.value.trim(), chatName: settingsForm.chatName.value.trim() };
    store(SETTINGS_KEY, settings);
    render();
    const newKey = settingsForm.serverKey.value.trim();
    if (newKey === serverKey) { toast('설정을 저장했어요.'); return; }
    connect(newKey);
  });

  async function connect(newKey) {
    if (!newKey) {
      serverKey = '';
      store(SERVER_KEY, '');
      orders = load(ORDERS_KEY, []);
      inboxMessages = [];
      setConn('local');
      render();
      renderInbox();
      toast('서버 연결을 끊었어요. 이 기기에 저장된 주문을 보여줘요.');
      return;
    }
    try {
      await api('/ping', { key: newKey });
    } catch (e) {
      toast(`⚠️ ${e.message}`);
      return;
    }
    serverKey = newKey;
    store(SERVER_KEY, newKey);
    orders = [];
    await sync({ quiet: false });
    toast('서버에 연결했어요. 카톡·문자 주문이 자동으로 들어와요.');
  }

  function renderServerStatus() {
    const local = load(ORDERS_KEY, []);
    $('#server-status').textContent = remote()
      ? `연결됨${lastSync ? ` · 마지막 확인 ${timeLabel(lastSync.toTimeString().slice(0, 5))}` : ''}`
      : '연결 안 됨 · 주문이 이 기기에만 저장돼요.';
    const btn = $('#upload-local-btn');
    btn.hidden = !(remote() && local.length);
    btn.textContent = `이 기기에 있던 주문 ${local.length}건을 서버로 옮기기`;
  }

  $('#upload-local-btn').addEventListener('click', async (e) => {
    const local = load(ORDERS_KEY, []);
    e.target.disabled = true;
    try {
      for (const o of local) await createOrder(orderData(o), [], o.status);
      store(ORDERS_KEY, []);
      render();
      renderServerStatus();
      toast(`주문 ${local.length}건을 서버로 옮겼어요.`);
    } catch (err) {
      fail(err);
    } finally {
      e.target.disabled = false;
    }
  });

  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#csv-btn').addEventListener('click', () => {
    const cols = [
      ['date', '날짜'], ['time', '시간'], ['status', '상태'], ['customer', '고객명'], ['phone', '연락처'], ['product', '상품'],
      ['price', '금액'], ['paid', '입금'], ['method', '수령'], ['style', '꽃·색감'], ['address', '배송지'], ['recipient', '받는 분'],
      ['recipientPhone', '받는 분 연락처'], ['ribbon', '리본'], ['card', '카드'], ['memo', '메모'],
    ];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const value = (o, k) => (k === 'status' ? statusLabel(o.status) : k === 'paid' ? (o.paid ? 'O' : '') : k === 'method' ? ({ pickup: '픽업', delivery: '배송' }[o.method] || '') : o[k]);
    const rows = [...orders].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map((o) => cols.map(([k]) => cell(value(o, k))).join(','));
    download(`꽃주문_${today()}.csv`, '﻿' + [cols.map(([, h]) => cell(h)).join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  });

  $('#backup-btn').addEventListener('click', () => {
    download(`꽃주문_백업_${today()}.json`, JSON.stringify({ version: 1, settings, orders }, null, 2), 'application/json');
  });

  $('#restore-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.orders)) throw new Error('bad file');
      const ids = new Set(orders.map((o) => o.id));
      const added = data.orders.filter((o) => o && o.id && !ids.has(o.id));
      if (remote()) {
        for (const o of added) await createOrder(orderData(o), [], o.status);
      } else {
        orders.push(...added);
        saveOrders();
      }
      render();
      toast(`백업에서 주문 ${added.length}건을 불러왔어요.`);
    } catch {
      toast('백업 파일을 읽지 못했어요.');
    }
  });

  // ---------- 다른 앱에서 공유로 들어온 글·사진 (홈 화면에 설치한 앱) ----------
  async function takeShared() {
    const params = new URLSearchParams(location.search);
    if (!params.has('shared') && !params.has('text')) return;
    history.replaceState(null, '', location.pathname);
    showTab('add');
    let text = [params.get('title'), params.get('text')].filter(Boolean).join('\n');
    const images = [];
    try {
      const cache = await caches.open('flower-share');
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        if (req.url.endsWith('shared/text')) text = [text, await res.text()].filter(Boolean).join('\n');
        else {
          const blob = await res.blob();
          images.push(new File([blob], `공유사진-${images.length + 1}`, { type: blob.type || 'image/png' }));
        }
        await cache.delete(req);
      }
    } catch { /* 공유 보관함을 못 여는 브라우저 */ }
    if (images.length) {
      await readImages(images);
    } else if (text) {
      paste.value = text;
      runParse();
    }
  }
  takeShared();

  // ---------- 새로 들어온 주문 (서버에 모인 카톡·문자) ----------
  const BASE_TITLE = document.title;
  const promoted = new Set();
  let inboxGroups = new Map();

  const shortTime = (iso) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${timeLabel(d.toTimeString().slice(0, 5))}`;
  };
  const channelBadge = (c) => (c === 'sms' ? '<span class="badge sms">문자</span>' : '<span class="badge kakao">카톡</span>');

  function renderInbox() {
    const box = $('#inbox');
    box.hidden = !remote();
    if (!remote()) { document.title = BASE_TITLE; return; }

    const msgs = inboxMessages.map((m) => ({ id: m.id, sender: m.sender, phone: m.phone, source: m.source, text: m.body, at: new Date(m.received_at) }));
    const groups = FlowerParser.parseMessages(msgs).map((g) => ({ ...g, key: g.messageIds.join(',') }));
    inboxGroups = new Map(groups.map((g) => [g.key, g]));
    const wanted = groups.filter((g) => g.isOrder || promoted.has(g.key)).reverse();
    const others = groups.filter((g) => !g.isOrder && !promoted.has(g.key)).reverse();

    // 입력 중인 카드가 지워지지 않도록 그대로 둘 카드는 다시 그리지 않습니다.
    const list = $('#inbox-list');
    const existing = new Map($$('form', list).map((f) => [f.dataset.key, f]));
    const cards = wanted.map((g) => {
      let f = existing.get(g.key);
      existing.delete(g.key);
      if (!f) {
        f = document.createElement('form');
        f.className = 'card cand order-form inbox-card';
        f.dataset.key = g.key;
        f.innerHTML = `
          <div class="cand-title">${channelBadge(g.channel)} <strong>${esc(g.sender)}</strong> <span class="muted small">${shortTime(g.receivedAt)}</span></div>
          ${formHTML(g, true)}
          <div class="row-actions end">
            <button type="button" class="btn ghost" data-act="dismiss">주문 아님</button>
            <button type="submit" class="btn primary">확정</button>
          </div>`;
        bindMethodToggle(f);
      }
      return f;
    });
    existing.forEach((f) => f.remove());
    const current = [...list.children];
    if (cards.length !== current.length || cards.some((f, i) => f !== current[i])) cards.forEach((f) => list.appendChild(f));

    $('#inbox-count').textContent = wanted.length || '';
    $('#inbox-empty').hidden = wanted.length > 0;
    $('#inbox-empty').textContent = `새 주문이 없어요.${lastSync ? ` (마지막 확인 ${timeLabel(lastSync.toTimeString().slice(0, 5))})` : ''}`;
    $('#inbox-other-wrap').hidden = others.length === 0;
    $('#inbox-other-count').textContent = others.length;
    $('#inbox-other').innerHTML = others.map((g) => `
      <li data-key="${g.key}">
        <div class="other-text">${channelBadge(g.channel)} <strong>${esc(g.sender)}</strong> <span class="muted small">${shortTime(g.receivedAt)}</span>
          <p>${esc(g.source.replace(/^.*?\d{2}:\d{2}\s+/gm, '').slice(0, 140))}</p></div>
        <div class="row-actions">
          <button type="button" class="btn small" data-act="promote">주문으로 만들기</button>
          <button type="button" class="btn small ghost" data-act="dismiss">숨기기</button>
        </div>
      </li>`).join('');
    document.title = wanted.length ? `(${wanted.length}) ${BASE_TITLE}` : BASE_TITLE;
  }

  async function dismissGroup(key) {
    const g = inboxGroups.get(key);
    if (!g) return;
    await api('/messages/dismiss', { method: 'POST', body: { ids: g.messageIds } });
    inboxMessages = inboxMessages.filter((m) => !g.messageIds.includes(m.id));
    renderInbox();
  }

  $('#inbox-list').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const g = inboxGroups.get(f.dataset.key);
    if (!g) return;
    f.querySelector('[type=submit]').disabled = true;
    createOrder(readForm(f, { source: g.source, receivedAt: g.receivedAt, channel: g.channel }), g.messageIds)
      .then(() => {
        inboxMessages = inboxMessages.filter((m) => !g.messageIds.includes(m.id));
        f.remove();
        renderInbox();
        render();
        toast('주문을 확정했어요 🌸');
      }, (err) => { f.querySelector('[type=submit]').disabled = false; fail(err); });
  });

  $('#inbox').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const key = btn.closest('[data-key]')?.dataset.key;
    if (btn.dataset.act === 'dismiss') {
      btn.disabled = true;
      dismissGroup(key).then(() => toast('정리했어요.'), fail);
    } else if (btn.dataset.act === 'promote') {
      promoted.add(key);
      renderInbox();
    }
  });
  $('#refresh-btn').addEventListener('click', () => sync({ quiet: false }));

  // 20초마다, 그리고 화면으로 돌아올 때마다 새 메시지를 확인합니다.
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  setConn(remote() ? 'ok' : 'local');
  render();
  renderInbox();
  sync({ quiet: false });
})();
