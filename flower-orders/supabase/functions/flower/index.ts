// 꽃 주문함 서버 (Supabase Edge Function)
//
//   POST /flower/ingest       휴대폰(MacroDroid)이 받은 카톡·문자를 보냄. key = 수집 키
//   GET  /flower/messages     아직 주문으로 정리되지 않은 메시지 (최근 14일)
//   POST /flower/messages/dismiss   { ids } 주문 아님 처리
//   GET  /flower/orders       주문 전체
//   POST /flower/orders       { order, status, messageIds } 주문 등록
//   PATCH /flower/orders/:id  { order, status } 주문 수정
//   DELETE /flower/orders/:id
//
// ingest 외의 요청은 x-flower-key 헤더에 매장 비밀번호가 있어야 합니다.
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-flower-key, authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const hashCache = new Map<string, string>();
async function keyMatches(kind: 'ingest' | 'dashboard', key: string | null) {
  if (!key) return false;
  let expected = hashCache.get(kind);
  if (!expected) {
    const { data } = await db.from('flower_config').select('value').eq('key', `${kind}_key_hash`).maybeSingle();
    if (!data) return false;
    expected = data.value as string;
    hashCache.set(kind, expected);
  }
  return (await sha256(key.trim())) === expected;
}

// MacroDroid는 쿼리 파라미터, 폼, JSON 어느 방식으로 보내도 받습니다.
async function readParams(req: Request, url: URL) {
  const params: Record<string, string> = Object.fromEntries(url.searchParams);
  const type = req.headers.get('content-type') || '';
  if (req.method === 'POST') {
    const raw = await req.text();
    if (raw) {
      if (type.includes('json')) {
        try { Object.assign(params, JSON.parse(raw)); } catch { /* 잘못된 JSON은 무시 */ }
      } else if (type.includes('x-www-form-urlencoded')) {
        Object.assign(params, Object.fromEntries(new URLSearchParams(raw)));
      } else if (!params.text) {
        params.text = raw;
      }
    }
  }
  return params;
}

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);

async function ingest(req: Request, url: URL) {
  const p = await readParams(req, url);
  if (!(await keyMatches('ingest', p.key || req.headers.get('x-flower-key')))) return json({ error: 'wrong key' }, 401);

  const body = clean(p.text ?? p.body ?? p.message, 4000);
  if (!body) return json({ ok: true, skipped: 'empty' });
  const source = /sms|문자|mms/i.test(p.source || '') ? 'sms' : 'kakao';
  const sender = clean(p.sender ?? p.title ?? p.name, 100);
  const phone = clean(p.phone ?? p.number, 40);

  // 같은 알림이 여러 번 들어오는 경우를 막습니다 (3분 안의 같은 내용).
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data: dup } = await db.from('flower_messages').select('id')
    .eq('sender', sender).eq('body', body).gte('received_at', since).limit(1);
  if (dup && dup.length) return json({ ok: true, skipped: 'duplicate' });

  const { error } = await db.from('flower_messages').insert({ source, sender, phone, body });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/flower/, '') || '/';

  try {
    if (path === '/ingest' || path === '/ingest/') return await ingest(req, url);

    if (!(await keyMatches('dashboard', req.headers.get('x-flower-key')))) return json({ error: 'wrong key' }, 401);

    if (path === '/ping') return json({ ok: true });

    if (path === '/messages' && req.method === 'GET') {
      const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await db.from('flower_messages')
        .select('id, source, sender, phone, body, received_at')
        .is('order_id', null).eq('dismissed', false).gte('received_at', since)
        .order('received_at', { ascending: true }).limit(500);
      if (error) throw error;
      return json({ messages: data });
    }

    if (path === '/messages/dismiss' && req.method === 'POST') {
      const { ids } = await req.json();
      const { error } = await db.from('flower_messages').update({ dismissed: true }).in('id', (ids || []).map(Number));
      if (error) throw error;
      return json({ ok: true });
    }

    if (path === '/orders' && req.method === 'GET') {
      const { data, error } = await db.from('flower_orders').select('*').order('created_at', { ascending: true }).limit(5000);
      if (error) throw error;
      return json({ orders: data });
    }

    if (path === '/orders' && req.method === 'POST') {
      const { order, status, messageIds } = await req.json();
      const { data, error } = await db.from('flower_orders')
        .insert({ data: order || {}, status: status || 'new' }).select().single();
      if (error) throw error;
      if (Array.isArray(messageIds) && messageIds.length) {
        await db.from('flower_messages').update({ order_id: data.id }).in('id', messageIds.map(Number));
      }
      return json({ order: data });
    }

    const m = path.match(/^\/orders\/([0-9a-f-]{36})$/);
    if (m && req.method === 'PATCH') {
      const { order, status } = await req.json();
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (order) patch.data = order;
      if (status) patch.status = status;
      const { data, error } = await db.from('flower_orders').update(patch).eq('id', m[1]).select().single();
      if (error) throw error;
      return json({ order: data });
    }
    if (m && req.method === 'DELETE') {
      await db.from('flower_messages').update({ order_id: null, dismissed: true }).eq('order_id', m[1]);
      const { error } = await db.from('flower_orders').delete().eq('id', m[1]);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
