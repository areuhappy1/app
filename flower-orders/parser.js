/*
 * 꽃집 주문 파서
 * 카카오톡 대화(내보내기/복사)나 문자 텍스트에서 주문 정보를 뽑아냅니다.
 * 브라우저에서는 window.FlowerParser, Node에서는 require('./parser.js')로 사용합니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlowerParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 날짜 도우미 ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  const KOR_NUM = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
  const toNum = (s) => (s in KOR_NUM ? KOR_NUM[s] : parseInt(s, 10));

  // ---------- 1. 카톡 대화 형식 인식 ----------
  const RE_HEADER = /^(.+?)\s*님과 카카오톡 대화/;
  const RE_SAVED = /^저장한 날짜\s*:/;
  // --------------- 2026년 9월 24일 목요일 ---------------
  const RE_DATE_LINE = /^[-=\s]*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*[월화수목금토일]요일)?[-=\s]*$/;
  // 모바일 내보내기: 2026년 9월 24일 오후 3:05, 홍길동 : 메시지  /  2026. 9. 24. 오후 3:05, 홍길동 : 메시지
  const RE_MOBILE = /^(\d{4})(?:년|\.)\s*(\d{1,2})(?:월|\.)\s*(\d{1,2})(?:일|\.)\s*(오전|오후)?\s*(\d{1,2}):(\d{2}),\s*(.+?)\s:\s?(.*)$/;
  // 모바일 내보내기의 시스템 메시지(입장/퇴장 등)
  const RE_SYSTEM = /^\d{4}(?:년|\.)\s*\d{1,2}(?:월|\.)\s*\d{1,2}(?:일|\.)\s*(?:오전|오후)?\s*\d{1,2}:\d{2}(?:,|$)/;
  // PC 내보내기·메시지 복사: [홍길동] [오후 3:05] 메시지
  const RE_PC = /^\[(.+?)\]\s*\[(오전|오후)?\s*(\d{1,2}):(\d{2})\]\s?(.*)$/;
  const RE_NOISE = /^(사진|동영상|이모티콘|사진 \d+장|음성메시지|삭제된 메시지입니다\.?|파일:.*)$/;

  const clock = (ampm, h) => {
    h = +h;
    if (ampm === '오후' && h < 12) h += 12;
    if (ampm === '오전' && h === 12) h = 0;
    return h;
  };

  function parseChat(text, now) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const messages = [];
    let header = '';
    let curDay = null;
    let last = null;
    let count = 0;

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (!header && !count && (m = line.match(RE_HEADER))) { header = m[1].trim(); continue; }
      if (RE_SAVED.test(line)) continue;
      if ((m = line.match(RE_DATE_LINE))) {
        curDay = new Date(+m[1], m[2] - 1, +m[3]);
        last = null;
        continue;
      }
      if ((m = line.match(RE_MOBILE))) {
        const at = new Date(+m[1], m[2] - 1, +m[3], clock(m[4], m[5]), +m[6]);
        last = { sender: m[7].trim(), at, text: m[8] };
        messages.push(last);
        count++;
        continue;
      }
      if ((m = line.match(RE_PC))) {
        const d = curDay || dayStart(now);
        const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), clock(m[2], m[3]), +m[4]);
        last = { sender: m[1].trim(), at, text: m[5] };
        messages.push(last);
        count++;
        continue;
      }
      if (RE_SYSTEM.test(line)) { last = null; continue; }
      if (last) last.text += '\n' + line;
    }

    for (const msg of messages) {
      msg.text = msg.text
        .split('\n')
        .filter((l) => !RE_NOISE.test(l.trim()))
        .join('\n')
        .trim();
    }
    return { isChat: count > 0, header, messages: messages.filter((m) => m.text) };
  }

  // 4시간 이상 대화가 끊기면 다른 주문으로 봅니다.
  const SESSION_GAP = 4 * 3600 * 1000;

  function splitSessions(messages) {
    const sessions = [];
    let cur = null;
    for (const msg of messages) {
      if (!cur || msg.at - cur.lastAt > SESSION_GAP) {
        cur = { messages: [], lastAt: msg.at };
        sessions.push(cur);
      }
      cur.messages.push(msg);
      cur.lastAt = msg.at;
    }
    return sessions;
  }

  // ---------- 2. 항목별 추출 ----------

  // 날짜
  const HOLIDAYS = [
    [/어버이\s*날/, 5, 8],
    [/스승의\s*날/, 5, 15],
    [/로즈\s*데이/, 5, 14],
    [/발렌타인|밸런타인/, 2, 14],
    [/화이트\s*데이/, 3, 14],
    [/크리스마스|성탄절/, 12, 25],
  ];
  const RELATIVE = { 오늘: 0, 금일: 0, 내일: 1, 낼: 1, 명일: 1, 모레: 2, 글피: 3 };
  const WEEKDAYS = '일월화수목금토';
  const RE_DATE_CONTEXT = /^.{0,15}?(?:\d{1,2}\s*시|\d{1,2}:\d{2}|오전|오후|저녁|아침|점심|픽업|배송|배달|까지|방문|찾으러|가지러|도착|받을|필요)/;

  function monthDay(month, day, base) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let d = new Date(base.getFullYear(), month - 1, day);
    if (d.getMonth() !== month - 1) return null;
    // 일주일 이상 지난 날짜면 내년으로 봅니다 (예: 12월에 "1월 3일")
    if (d < addDays(base, -7)) d = new Date(base.getFullYear() + 1, month - 1, day);
    return d;
  }

  function findDate(text, baseDate) {
    const base = dayStart(baseDate);
    const found = [];
    const add = (index, length, date, weight = 0) => {
      if (date) found.push({ index, end: index + length, date, weight });
    };
    let m;

    for (m of text.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) add(m.index, m[0].length, monthDay(+m[1], +m[2], base), 1);
    for (m of text.matchAll(/(?<![\d.\/:,-])(\d{1,2})\s*[\/.]\s*(\d{1,2})(?![\d:,]|\s*만|\s*[.\/]\s*\d)/g)) {
      add(m.index, m[0].length, monthDay(+m[1], +m[2], base), 1);
    }
    for (m of text.matchAll(/(?<![\d.\/])(?<!월\s*)(\d{1,2})\s*일(?![간동차째])(?!\s*(?:후|뒤|전|동안))(?=\s|$|[에날까,.)!~])/g)) {
      const day = +m[1];
      let d = new Date(base.getFullYear(), base.getMonth(), day);
      if (d.getDate() !== day) continue;
      if (d < base) d = new Date(base.getFullYear(), base.getMonth() + 1, day);
      add(m.index, m[0].length, d);
    }
    for (m of text.matchAll(/(\d{1,2})\s*일\s*(?:후|뒤)/g)) add(m.index, m[0].length, addDays(base, +m[1]));
    for (m of text.matchAll(/(?<![가-힣])(내일\s*모레|낼\s*모레|모레|글피|내일|낼|오늘|금일|명일)/g)) {
      const word = m[1].replace(/\s/g, '');
      const offset = /모레$/.test(word) ? 2 : RELATIVE[word];
      add(m.index, m[0].length, addDays(base, offset), word === '오늘' ? -0.5 : 0);
    }
    for (m of text.matchAll(/(이번\s*주|다음\s*주|담주|다다음\s*주)?\s*([월화수목금토일])(?:요일|욜)/g)) {
      const dow = WEEKDAYS.indexOf(m[2]);
      const baseDow = base.getDay();
      const mon = (x) => (x + 6) % 7; // 월요일 시작 기준
      const prefix = (m[1] || '').replace(/\s/g, '');
      let offset;
      if (prefix === '이번주') offset = mon(dow) - mon(baseDow);
      else if (prefix === '다음주' || prefix === '담주') offset = 7 + mon(dow) - mon(baseDow);
      else if (prefix === '다다음주') offset = 14 + mon(dow) - mon(baseDow);
      else offset = (dow - baseDow + 7) % 7;
      add(m.index, m[0].length, addDays(base, offset), prefix ? 1 : 0);
    }
    for (const [re, month, day] of HOLIDAYS) {
      if ((m = text.match(re))) add(m.index, m[0].length, monthDay(month, day, base));
    }
    if (!found.length) return null;

    // 시간·수령 표현이 바로 뒤따르는 날짜를 우선합니다.
    let best = null;
    for (const f of found) {
      f.score = 1 + f.weight + (RE_DATE_CONTEXT.test(text.slice(f.end)) ? 2 : 0);
      if (!best || f.score > best.score || (f.score === best.score && f.index < best.index)) best = f;
    }
    return { date: ymd(best.date), index: best.index };
  }

  // 시간
  function hour24(word, h) {
    if (/오후|저녁|밤/.test(word) && h < 12) return h + 12;
    if (/낮|점심/.test(word) && h <= 6) return h + 12;
    if (/오전|아침|새벽/.test(word)) return h === 12 ? 0 : h;
    // "3시"처럼 오전/오후가 없으면 영업시간 기준으로 1~7시는 오후로 봅니다.
    if (!word && h >= 1 && h <= 7) return h + 12;
    return h;
  }

  function findTime(text, fromIndex) {
    const found = [];
    let m;
    const re = /(오전|오후|아침|점심|낮|저녁|밤|새벽)?\s*(?:(\d{1,2})\s*[~\-]\s*)?(\d{1,2})\s*시(?!간)(?:\s*(반)|\s*(\d{1,2})\s*분)?/g;
    for (m of text.matchAll(re)) {
      const h = hour24(m[1] || '', +(m[2] || m[3]));
      const min = m[4] ? 30 : m[5] ? +m[5] : 0;
      if (h <= 24 && min < 60) found.push({ index: m.index, value: `${pad(h % 24)}:${pad(min)}` });
    }
    for (m of text.matchAll(/(오전|오후)?\s*(?<![\d.])(\d{1,2}):(\d{2})(?!\d)/g)) {
      const h = hour24(m[1] || '', +m[2]);
      if (h <= 24 && +m[3] < 60) found.push({ index: m.index, value: `${pad(h % 24)}:${m[3]}` });
    }
    if ((m = text.match(/정오/))) found.push({ index: m.index, value: '12:00' });
    if (!found.length) return '';
    found.sort((a, b) => a.index - b.index);
    return (found.find((f) => f.index >= fromIndex) || found[0]).value;
  }

  // 상품
  const PRODUCTS = [
    ['용돈꽃다발', /(?:용돈|현금|돈)\s*(?:꽃다발|꽃\s*박스|박스)/g],
    ['근조화환', /근조\s*(?:3단\s*)?(?:화환|꽃바구니|바구니)?/g],
    ['축하화환', /(?:축하|개업|결혼|승진|취임|오픈)\s*(?:3단\s*)?화환/g],
    ['화환', /(?:3단\s*)?화환/g],
    ['웨딩부케', /(?:웨딩\s*)?부케/g],
    ['꽃바구니', /꽃\s*바구니|바구니/g],
    ['꽃상자', /꽃\s*(?:상자|박스)|플라워\s*박스/g],
    ['꽃다발', /꽃\s*다발/g],
    ['동양란', /동양\s*[란난]/g],
    ['서양란', /서양\s*[란난]|호접\s*[란난]/g],
    [null, /몬스테라|뱅갈\s*고무나무|고무나무|금전수|스투키|산세베리아|해피트리|여인초|올리브\s*나무|관엽\s*식물|관엽/g],
    ['화분', /화분/g],
    ['센터피스', /센터피스/g],
    ['부토니에', /부토니[에어]/g],
    ['코사지', /코사지|코르사주/g],
  ];
  const RE_QTY = /^\s*(?:을|를|로|으로|은|는|이|가|도)?\s*(\d{1,3}|한|하나|두|둘|세|셋|네|넷|다섯)\s*(개|다발|바구니|점|세트|분|대|개씩)?/;

  function findItems(text) {
    const used = [];
    const overlaps = (s, e) => used.some(([a, b]) => s < b && e > a);
    const items = new Map();
    const funeral = /근조|조의|장례|빈소|부고|발인/.test(text);
    const congrats = /축하|개업|결혼|웨딩|승진|취임|오픈|개원|창립/.test(text);

    for (const [name, re] of PRODUCTS) {
      for (const m of text.matchAll(re)) {
        const start = m.index;
        let end = start + m[0].length;
        if (overlaps(start, end)) continue;
        let label = name || m[0].replace(/\s+/g, '');
        if (label === '화환') label = funeral ? '근조화환' : congrats ? '축하화환' : '화환';
        let qty = 1;
        const q = text.slice(end).match(RE_QTY);
        if (q && (q[2] || /^(하나|둘|셋|넷)$/.test(q[1]))) {
          qty = toNum(q[1]) || 1;
          end += q[0].length;
        }
        used.push([start, end]);
        items.set(label, Math.max(items.get(label) || 0, qty));
      }
    }
    return [...items].map(([name, qty]) => ({ name, qty }));
  }

  // 꽃 종류·색감
  const FLOWERS = ['장미', '튤립', '수국', '작약', '안개꽃', '카네이션', '해바라기', '프리지아', '프리지어', '라넌큘러스', '거베라', '리시안셔스', '백합', '국화', '카라', '스토크', '델피니움', '유칼립투스', '목화', '아네모네', '히아신스', '스위트피', '다알리아', '달리아', '미니장미', '소국', '왁스플라워', '스프레이'];
  const COLORS = [
    ['핑크', /핑크|분홍/], ['레드', /레드|빨간|빨강/], ['화이트', /화이트|흰|하얀/], ['옐로우', /옐로우|노란|노랑/],
    ['퍼플', /퍼플|보라/], ['오렌지', /오렌지|주황/], ['블루', /블루|파란|하늘색/], ['파스텔', /파스텔/], ['그린', /그린|초록/],
  ];

  function findStyle(text) {
    const flowers = FLOWERS.filter((f) => text.includes(f));
    const colors = COLORS.filter(([, re]) => re.test(text)).map(([c]) => c);
    const parts = [...new Set(flowers)];
    if (colors.length) parts.push(colors.join('·') + '톤');
    return parts.join(', ');
  }

  // 금액
  function findPrice(text) {
    const found = [];
    let m;
    for (m of text.matchAll(/(\d+(?:\.\d+)?)\s*만(?![들드나큼])(?:\s*(\d)\s*천)?\s*원?/g)) found.push({ index: m.index, value: Math.round(parseFloat(m[1]) * 10000) + (m[2] ? +m[2] * 1000 : 0) });
    for (m of text.matchAll(/(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원/g)) found.push({ index: m.index, value: parseInt(m[1].replace(/,/g, ''), 10) });
    for (m of text.matchAll(/(\d{1,2})\s*천\s*원/g)) found.push({ index: m.index, value: +m[1] * 1000 });
    const ok = found.filter((f) => f.value >= 5000 && f.value <= 5000000).sort((a, b) => a.index - b.index);
    return ok.length ? ok[0].value : null;
  }

  // 전화번호
  const RE_PHONE = /(?<!\d)(01[016789]|0\d{1,2})[-.\s]?(\d{3,4})[-.\s]?(\d{4})(?!\d)/g;
  const findPhones = (text) => [...text.matchAll(RE_PHONE)].map((m) => ({ index: m.index, value: `${m[1]}-${m[2]}-${m[3]}` }));

  // 이름 뒤에 올 수 있는 말 (조사·호칭·구분자)
  const NAME_END = '(?=님|씨|\\s|,|\\.|/|\\(|\\)|$|\\d|이고|이에요|입니다|이요|요|에게|한테)';
  const NAME_STOP = /^(성함|이름|연락처|번호|전화|주소|정보|누구|저희|제가|본인)$/;

  function findRecipient(text) {
    const re = new RegExp(`(?:받(?:으시)?는\\s*(?:분|사람|이)|받으실\\s*분|수령인|수취인)\\s*(?:(?:은|는|이)(?=[\\s:：])|성함)?\\s*[:：]?\\s*(?:성함\\s*[:：]?\\s*)?([가-힣]{2,4}?)${NAME_END}`);
    const m = text.match(re);
    if (!m || NAME_STOP.test(m[1])) return { name: '', phone: '' };
    const phone = findPhones(text.slice(m.index, m.index + m[0].length + 40))[0];
    return { name: m[1], phone: phone ? phone.value : '' };
  }

  function findName(text) {
    const m = text.match(new RegExp(`(?:주문자|주문하는\\s*사람|성함|이름)\\s*(?:(?:은|는|이)(?=[\\s:：]))?\\s*[:：]?\\s*([가-힣]{2,4}?)${NAME_END}`));
    return m && !NAME_STOP.test(m[1]) ? m[1] : '';
  }

  // 주소
  const REGIONS = '서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주';
  const RE_ROAD = /[가-힣\d]+(?:로|길)\s*\d+(?:-\d+)?|[가-힣\d]+(?:동|읍|면|리)\s+\d+(?:-\d+)?(?:번지)?/;
  const RE_AREA = new RegExp(`(?:${REGIONS})|[가-힣]+(?:시|구|군)(?:\\s|$)`);
  const RE_VENUE = /장례식장|병원|웨딩홀|예식장|컨벤션|호텔|교회|성당|빈소/;

  function cleanAddress(s) {
    return s
      .replace(RE_PHONE, '')
      .replace(/\s*(?:받(?:으시)?는\s*(?:분|사람)|수령인|연락처|리본|카드).*$/, '')
      .replace(/\s*(?:으로|로|에|까지)?\s*(?:보내|배송|배달|부탁|해\s*주).*$/, '')
      .replace(/^[\s:：,.-]+|[\s:：,.-]+$/g, '')
      .trim();
  }

  function findAddress(text) {
    const m = text.match(/(?:주소|배송지|배달\s*주소|보낼\s*곳|받는\s*곳)\s*(?:는|은|가|이)?\s*[:：]?\s*([^\n]+)/);
    if (m && cleanAddress(m[1])) return cleanAddress(m[1]);
    const lines = text.split('\n');
    const road = lines.find((l) => RE_ROAD.test(l) && RE_AREA.test(l));
    if (road) return cleanAddress(road);
    const venue = lines.find((l) => RE_VENUE.test(l) && l.length < 80);
    return venue ? cleanAddress(venue) : '';
  }

  // 수령 방법
  function findMethod(text) {
    const delivery = (text.match(/배송|배달|퀵|택배|보내\s*(?:주세요|줄|주실|드려)/g) || []).length;
    const pickup = (text.match(/픽업|찾으러|가지러|찾아\s*갈|방문|들를|가져\s*갈|받으러|수령할/g) || []).length;
    if (delivery > pickup) return 'delivery';
    if (pickup > delivery) return 'pickup';
    return '';
  }

  const unquote = (s) => s.replace(/^[\s"“'‘「]+|[\s"”'’」]+$/g, '').trim();

  function findRibbon(text) {
    const parts = [];
    let m = text.match(/(?:리본|경조사어)\s*(?:문구|글씨|글귀|내용)?\s*(?:에는|에|은|는)?\s*[:：]?\s*([^\n]+)/);
    if (m) {
      const v = unquote(m[1].replace(/\s*보내는\s*(?:분|사람|이).*$/, '').replace(/\s*(?:이?라고|으로|로)?\s*(?:써|적어|넣어|해)\s*주.*$/, '').replace(/[\s/,]+$/, ''));
      if (v) parts.push(v);
    }
    m = text.match(/보내는\s*(?:분|사람|이)\s*(?:은|는)?\s*[:：]?\s*([^\n]+)/);
    if (m) {
      const v = unquote(m[1].replace(/\s*(?:이?라고|으로|로)?\s*(?:써|적어|넣어|해)\s*주.*$/, ''));
      if (v) parts.push('보내는 분: ' + v);
    }
    return parts.join(' / ');
  }

  function findCard(text) {
    let m = text.match(/(?:카드|메시지\s*카드|편지)[^\n"“]{0,12}["“]([^"”\n]+)["”]/);
    if (m) return m[1].trim();
    m = text.match(/(?:메시지\s*카드|카드|편지)\s*(?:문구|내용|메시지)?\s*(?:에는|에|은|는)?\s*[:：]\s*([^\n]+)/);
    return m ? unquote(m[1]) : '';
  }

  const RE_PAID = /입금\s*(?:했|완료|드렸|하였|해\s*드렸)|이체\s*(?:했|완료|드렸)|송금\s*(?:했|완료|드렸)|결제\s*(?:했|완료)/;
  const RE_INTENT = /주문|예약|가능할까요|가능한가요|가능하세요|될까요|되나요|부탁|해\s*주세요|만들어|보내\s*주세요|픽업|배송|배달/;

  // 주문처럼 보이는 정도 (고객이 보낸 글 기준)
  function orderSignal(text) {
    const items = findItems(text).length;
    const score = items * 3
      + (findPrice(text) ? 1 : 0)
      + (findDate(text, new Date()) ? 1 : 0)
      + (findTime(text, 0) ? 1 : 0)
      + (RE_INTENT.test(text) ? 1 : 0)
      + (findAddress(text) ? 1 : 0);
    return score;
  }

  const formatItems = (items) => items.map((i) => `${i.name} ×${i.qty}`).join(', ');

  function extractOrder(text, baseDate) {
    const date = findDate(text, baseDate);
    const recipient = findRecipient(text);
    const address = findAddress(text);
    let method = findMethod(text);
    if (!method && (address || recipient.name)) method = 'delivery';
    const phone = findPhones(text).map((p) => p.value).find((p) => p !== recipient.phone) || '';

    return {
      customer: findName(text),
      phone,
      product: formatItems(findItems(text)),
      style: findStyle(text),
      price: findPrice(text),
      date: date ? date.date : '',
      time: findTime(text, date ? date.index : 0),
      method,
      address,
      recipient: recipient.name,
      recipientPhone: recipient.phone,
      ribbon: findRibbon(text),
      card: findCard(text),
      paid: RE_PAID.test(text),
      memo: '',
    };
  }

  // ---------- 3. 전체 흐름 ----------
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  /**
   * @param {string} text 붙여넣은 카톡 대화 또는 문자
   * @param {{now?: Date, shopName?: string}} opts shopName: 카톡에 보이는 가게(내) 이름
   * @returns {{format: 'kakao'|'text', candidates: Array}}
   */
  function parse(text, opts = {}) {
    const now = opts.now || new Date();
    const shopName = (opts.shopName || '').trim();
    const chat = parseChat(text || '', now);
    const candidates = [];

    if (chat.isChat) {
      const isShop = (sender) => (shopName ? sender === shopName : chat.header ? sender !== chat.header : false);
      for (const session of splitSessions(chat.messages)) {
        const custMsgs = session.messages.filter((m) => !isShop(m.sender));
        if (!custMsgs.length) continue;
        const custText = custMsgs.map((m) => m.text).join('\n');
        const allText = session.messages.map((m) => m.text).join('\n');
        if (orderSignal(custText) < 3) continue;

        const order = extractOrder(allText, custMsgs[0].at);
        order.customer = chat.header || custMsgs[0].sender;
        const custPhone = findPhones(custText).map((p) => p.value).find((p) => p !== order.recipientPhone);
        if (custPhone) order.phone = custPhone;
        order.source = session.messages
          .map((m) => `[${m.sender}] ${ymd(m.at).slice(5).replace('-', '/')} ${fmtTime(m.at)}  ${m.text}`)
          .join('\n');
        order.receivedAt = custMsgs[0].at.toISOString();
        candidates.push(order);
      }
      return { format: 'kakao', candidates };
    }

    // 일반 텍스트(문자 등): 빈 줄 두 개 이상 또는 --- 로 여러 주문을 구분합니다.
    const blocks = (text || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n\s*\n\s*\n+|\n-{3,}\n/)
      .map((b) => b.trim())
      .filter(Boolean);
    for (const block of blocks) {
      if (blocks.length > 1 && orderSignal(block) < 3) continue;
      const order = extractOrder(block, now);
      order.source = block;
      order.receivedAt = now.toISOString();
      candidates.push(order);
    }
    return { format: 'text', candidates };
  }

  const RE_PHONE_ONLY = /^\+?[\d\s().-]{8,}$/;
  function normalizePhone(p) {
    let d = String(p || '').replace(/[^\d]/g, '');
    if (d.startsWith('82')) d = '0' + d.slice(2);
    const m = d.match(/^(01[016789]|02|0\d{2})(\d{3,4})(\d{4})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : String(p || '').trim();
  }

  /**
   * 서버로 모인 메시지(카톡 알림·문자)를 보낸 사람별·대화 흐름별로 묶어 주문 후보로 만듭니다.
   * @param {Array<{id, sender, phone?, source?, text, at: Date}>} messages
   * @returns {Array} 주문 후보. isOrder가 false면 주문이 아닌 대화(인사·문의 등)입니다.
   */
  function parseMessages(messages) {
    const bySender = new Map();
    for (const msg of [...messages].sort((a, b) => a.at - b.at)) {
      const who = (msg.sender || '').trim() || normalizePhone(msg.phone) || '알 수 없음';
      if (!bySender.has(who)) bySender.set(who, []);
      bySender.get(who).push(msg);
    }
    const out = [];
    for (const [who, msgs] of bySender) {
      for (const session of splitSessions(msgs)) {
        const first = session.messages[0];
        const text = session.messages.map((m) => m.text).join('\n');
        const order = extractOrder(text, first.at);
        const senderIsPhone = RE_PHONE_ONLY.test(who);
        if (!order.customer && !senderIsPhone) order.customer = who;
        if (!order.phone) {
          const p = session.messages.map((m) => m.phone).find(Boolean) || (senderIsPhone ? who : '');
          if (p) order.phone = normalizePhone(p);
        }
        order.isOrder = orderSignal(text) >= 3;
        order.channel = session.messages.some((m) => m.source === 'sms') ? 'sms' : 'kakao';
        order.sender = who;
        order.messageIds = session.messages.map((m) => m.id);
        order.receivedAt = first.at.toISOString();
        order.source = session.messages
          .map((m) => `${ymd(m.at).slice(5).replace('-', '/')} ${fmtTime(m.at)}  ${m.text}`)
          .join('\n');
        out.push(order);
      }
    }
    return out.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }

  return { parse, parseChat, parseMessages, extractOrder, orderSignal, ymd };
});
