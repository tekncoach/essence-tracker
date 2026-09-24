// Fuel return alerts for essence-tracker.
// The app registers "tell me when <fuel> is back at <station>" with its Web Push subscription; every hour the
// Worker checks the official feed (and 2aaz when the feed is silent about a fuel), pushes a notification for each
// fuel that is buyable again and deletes the alert: alerts are one-shot and expire after TTL_DAYS anyway.

import { sendPush } from './push.js';
import { totalStatus } from './total.js';

const TTL_DAYS = 7;
const FUELS = ['SP98', 'E10', 'SP95', 'Gazole', 'E85', 'GPLc'];
const LABELS = { SP98: 'SP98', E10: 'E10 (SP95-E10)', SP95: 'SP95', Gazole: 'Gazole', E85: 'E85', GPLc: 'GPLc' };
const OFFICIAL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
const BRAND_API = 'https://api.prix-carburants.2aaz.fr/station/';
const EXTRA_FUELS = { Gazole: 'Gazole', SP95: 'SP95', 'SP95-E10': 'E10', SP98: 'SP98', E85: 'E85', GPLc: 'GPLc' };

const cors = (req, env) => {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGINS.split(',').includes(origin) ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
};
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

// Alerts of one subscription share a prefix, so the app can list its own without seeing anybody else's.
async function prefixOf(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return 'alert:' + [...new Uint8Array(digest).slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('') + ':';
}

// PUSH_HTTP_OK (local .dev.vars only) lets tests point subscriptions at a local mock push service.
const validSubscription = (s, env) => s && typeof s.endpoint === 'string'
  && (s.endpoint.startsWith('https://') || env.PUSH_HTTP_OK === '1' && s.endpoint.startsWith('http://127.0.0.1'))
  && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string';
const validAlert = a => /^\d{5,9}$/.test(String(a.stationId)) && FUELS.includes(a.fuel);

const vapid = env => ({ publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT });

async function handle(req, env, ctx) {
  const headers = cors(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const { pathname } = new URL(req.url);
  const body = req.method === 'POST' || req.method === 'DELETE' ? await req.json().catch(() => ({})) : {};

  if (pathname === '/alerts' && req.method === 'POST') {
    // { subscription, stationId, fuel, name }
    if (!validSubscription(body.subscription, env) || !validAlert(body)) return json({ error: 'bad request' }, 400, headers);
    const expires = Date.now() + TTL_DAYS * 864e5;
    const name = String(body.name || '').slice(0, 80);
    await env.ALERTS.put(`${await prefixOf(body.subscription.endpoint)}${body.stationId}:${body.fuel}`,
      JSON.stringify({ subscription: body.subscription, stationId: String(body.stationId), fuel: body.fuel, name }),
      { expirationTtl: TTL_DAYS * 86400, metadata: { stationId: String(body.stationId), fuel: body.fuel, name, expires } });
    return json({ ok: true, expires }, 200, headers);
  }
  if (pathname === '/alerts' && req.method === 'DELETE') {
    // { endpoint, stationId, fuel }
    if (typeof body.endpoint !== 'string' || !validAlert(body)) return json({ error: 'bad request' }, 400, headers);
    await env.ALERTS.delete(`${await prefixOf(body.endpoint)}${body.stationId}:${body.fuel}`);
    return json({ ok: true }, 200, headers);
  }
  if (pathname === '/alerts/list' && req.method === 'POST') {
    // { endpoint } — POST so the endpoint does not end up in URLs and logs
    if (typeof body.endpoint !== 'string') return json({ error: 'bad request' }, 400, headers);
    const { keys } = await env.ALERTS.list({ prefix: await prefixOf(body.endpoint) });
    return json({ alerts: keys.map(k => k.metadata) }, 200, headers);
  }
  if (pathname === '/total' && req.method === 'GET') {
    // ?codes=NF…,NF… — TotalEnergies' availability, shown next to the official one on Total stations
    const codes = (new URL(req.url).searchParams.get('codes') || '').split(',');
    return json(await totalStatus(codes, env, ctx), 200, { ...headers, 'Cache-Control': 'max-age=300' });
  }
  if (pathname === '/test' && req.method === 'POST') {
    // { subscription } — confirms that notifications reach the device
    if (!validSubscription(body.subscription, env)) return json({ error: 'bad request' }, 400, headers);
    const status = await sendPush(body.subscription,
      { title: 'Alertes activées', body: 'Vous serez prévenu ici du retour d’un carburant.', url: './' }, vapid(env));
    return json({ status }, 200, headers);
  }
  return json({ error: 'not found' }, 404, headers);
}

// Buyable fuels per station: { id: { fuel: price } }, from the official feed, completed by 2aaz for the fuels the
// feed says nothing about (it sometimes drops a fuel in rupture altogether).
async function availability(ids, wantedByStation) {
  const out = Object.fromEntries(ids.map(id => [id, {}]));
  const known = Object.fromEntries(ids.map(id => [id, new Set()]));
  for (let i = 0; i < ids.length; i += 50) {
    const where = encodeURIComponent(`id IN (${ids.slice(i, i + 50).join(',')})`);
    const res = await fetch(`${OFFICIAL}?where=${where}&select=id,prix,rupture&limit=100`);
    for (const r of (await res.json()).results || []) {
      const list = v => { const x = typeof v === 'string' ? JSON.parse(v) : v; return !x ? [] : Array.isArray(x) ? x : [x]; };
      for (const p of list(r.prix)) { out[r.id][p['@nom']] = +p['@valeur']; known[r.id].add(p['@nom']); }
      for (const x of list(r.rupture)) { delete out[r.id][x['@nom']]; known[r.id].add(x['@nom']); }
    }
  }
  for (const id of ids) {
    if ([...wantedByStation[id]].every(f => known[id].has(f))) continue;
    try {
      const d = await (await fetch(BRAND_API + id, { headers: { Accept: 'application/json' } })).json();
      for (const f of d.Fuels || []) {
        const n = EXTRA_FUELS[f.shortName];
        if (n && !known[id].has(n) && f.available) out[id][n] = f.Price?.value;
      }
    } catch {}
  }
  return out;
}

async function checkAlerts(env) {
  const entries = [];
  let cursor;
  do {
    const page = await env.ALERTS.list({ prefix: 'alert:', cursor });
    entries.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  if (!entries.length) return { alerts: 0, sent: 0 };

  const wanted = {};
  for (const { metadata: m } of entries) (wanted[m.stationId] ??= new Set()).add(m.fuel);
  const avail = await availability(Object.keys(wanted), wanted);

  let sent = 0;
  for (const { name: key, metadata: m } of entries) {
    const price = avail[m.stationId]?.[m.fuel];
    if (price === undefined) continue;
    const alert = await env.ALERTS.get(key, 'json');
    if (!alert) continue;
    // One unreachable push service must not stop the round: that alert stays and is retried next hour.
    const status = await sendPush(alert.subscription, {
      title: `${LABELS[m.fuel]} de retour`,
      body: `${m.name || 'Station ' + m.stationId}${price ? ` : ${price.toFixed(3).replace('.', ',')} €` : ''}`,
      url: `./?station=${m.stationId}`,
    }, vapid(env)).catch(e => { console.log('push failed', m.stationId, m.fuel, e.message); return 0; });
    // One-shot: delete once delivered, and also when the push service says the subscription is gone.
    if (status < 300 || status === 404 || status === 410) await env.ALERTS.delete(key);
    if (status < 300) sent++;
  }
  return { alerts: entries.length, sent };
}

// Hourly comparison log, to learn which source is right: for the stations in KV key "watch" ([{ id, nf, name }],
// set with wrangler, not versioned), the official status and TotalEnergies' status of SP98 and E10.
// One KV write per hour into "log:<day>", kept 30 days.
async function logSources(env) {
  const watch = await env.ALERTS.get('watch', 'json');
  if (!watch?.length) return { logged: 0 };
  const where = encodeURIComponent(`id IN (${watch.map(w => w.id).join(',')})`);
  const rows = (await (await fetch(`${OFFICIAL}?where=${where}&select=id,prix,rupture&limit=100`)).json()).results || [];
  const list = v => { const x = typeof v === 'string' ? JSON.parse(v) : v; return !x ? [] : Array.isArray(x) ? x : [x]; };
  const official = {};
  for (const r of rows) {
    const st = official[r.id] = {};
    for (const p of list(r.prix)) st[p['@nom']] = ['dispo', p['@maj']];
    for (const x of list(r.rupture)) st[x['@nom']] = ['rupture', x['@debut']];
  }
  const total = await totalStatus(watch.map(w => w.nf), env);
  const at = new Date().toISOString();
  const snapshot = watch.map(w => ({
    id: w.id, name: w.name,
    ...Object.fromEntries(['SP98', 'E10'].map(f => [f, { gouv: official[w.id]?.[f] || ['absent'], total: total[w.nf]?.[f] || 'absent' }])),
  }));
  const key = `log:${at.slice(0, 10)}`;
  const day = (await env.ALERTS.get(key, 'json')) || [];
  day.push({ at, stations: snapshot });
  await env.ALERTS.put(key, JSON.stringify(day), { expirationTtl: 30 * 86400 });
  return { logged: snapshot.length };
}

export default {
  fetch: (req, env, ctx) => handle(req, env, ctx),
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(checkAlerts(env).then(r => console.log('alerts checked', r)));
    ctx.waitUntil(logSources(env).then(r => console.log('sources logged', r)).catch(e => console.log('log failed', e.message)));
  },
};
