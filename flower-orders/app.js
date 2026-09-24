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

  function formHTML(o) {
    const missing = (v) => (v ? '' : ' missing');
    return `
      <div class="form-grid">
        ${field('customer', '고객명', o.customer)}
        ${field('phone', '연락처', o.phone, { type: 'tel', placeholder: '010-0000-0000' })}
        <label class="field wide${missing(o.product)}"><span class="label">상품</span>
          <input name="product" value="${esc(o.product)}" placeholder="예: 꽃다발 ×1, 동양란 ×1" autocomplete="off"></label>
        ${field('price', '금액(원)', o.price ?? '', { inputmode: 'numeric', placeholder: '50000' })}
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
        ${field('ribbon', '리본 문구', o.ribbon, { wide: true, placeholder: '축 개업 / 보내는 분: OOO' })}
        ${field('card', '카드 문구', o.card, { wide: true })}
        <label class="field wide"><span class="label">메모</span>
          <textarea name="memo" rows="2" placeholder="요청사항">${esc(o.memo)}</textarea></label>
        <label class="check wide"><input type="checkbox" name="paid"${o.paid ? ' checked' : ''}> 💰 입금 확인</label>
      </div>
      ${o.source ? `<details class="source"><summary>원본 대화 보기</summary><pre>${esc(o.source)}</pre></details>` : ''}`;
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
      o.updatedAt = new Date().toISOString();
      saveOrders();
      render();
      toast(`${o.customer || '주문'} → ${statusLabel(o.status)}`);
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
    orders = orders.filter((o) => o !== editing);
    saveOrders();
    editDialog.close('deleted');
    render();
    toast('주문을 삭제했어요.');
  });

  editDialog.addEventListener('close', () => {
    if (editDialog.returnValue === 'save' && editing) {
      Object.assign(editing, readForm(editForm, {}), { updatedAt: new Date().toISOString() });
      saveOrders();
      render();
      toast('저장했어요.');
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

  function addOrder(data) {
    const now = new Date().toISOString();
    orders.push({ ...data, id: uid(), status: 'new', createdAt: now, updatedAt: now });
  }

  function takeCandidate(form, save) {
    const i = Number(form.dataset.index);
    if (save) addOrder(readForm(form, { source: candidates[i].source, key: candidates[i].key, receivedAt: candidates[i].receivedAt }));
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
    takeCandidate(e.target, true);
    saveOrders();
    render();
    toast('주문을 등록했어요 🌸');
  });
  $('#candidates').addEventListener('click', (e) => {
    if (e.target.dataset.act === 'skip') takeCandidate(e.target.closest('form'), false);
  });
  $('#save-all-btn').addEventListener('click', () => {
    const forms = $$('#candidates form');
    forms.forEach((f) => takeCandidate(f, true));
    saveOrders();
    render();
    toast(`주문 ${forms.length}건을 등록했어요 🌸`);
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
    settingsDialog.returnValue = '';
    settingsDialog.showModal();
  });
  settingsDialog.addEventListener('close', () => {
    if (settingsDialog.returnValue !== 'save') return;
    settings = { shopName: settingsForm.shopName.value.trim(), chatName: settingsForm.chatName.value.trim() };
    store(SETTINGS_KEY, settings);
    render();
    toast('설정을 저장했어요.');
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
      orders.push(...added);
      saveOrders();
      render();
      toast(`백업에서 주문 ${added.length}건을 불러왔어요.`);
    } catch {
      toast('백업 파일을 읽지 못했어요.');
    }
  });

  // ---------- 공유하기로 들어온 글 (안드로이드 홈 화면 앱) ----------
  const params = new URLSearchParams(location.search);
  const shared = [params.get('title'), params.get('text')].filter(Boolean).join('\n');
  if (shared) {
    history.replaceState(null, '', location.pathname);
    showTab('add');
    paste.value = shared;
    runParse();
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
})();
