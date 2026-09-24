// TotalEnergies' own availability per fuel, from the internal API behind locator.totalenergies.com. It is a second
// opinion next to the stations' declarations to the ministry, which disagree with it on some Total stations (checked
// on 2026-09-24: 5 of 20 fuel statuses around Montrouge). Not a public API: the key comes from their web front end
// (secret TE_API_KEY) and it may change or close without notice, so every failure just yields "unknown".

const API = 'https://apis.poifinder.alzp.tgscloud.net/poi-finder-store-locator-back/api/v1/point-of-interest';
const CACHE_SECONDS = 600;
// Total product codes -> app fuel names. Diesel: plain GO, else B10.
const PRODUCTS = { SP8: 'SP98', E10: 'E10', SP95: 'SP95', GO: 'Gazole', B10: 'Gazole', E85: 'E85', GPLC: 'GPLc' };
export const MAX_CODES = 40;   // Workers free plan: 50 subrequests per invocation

// { SP98: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN', ... } for one station (NFxxxxxx), or null when unreachable.
async function station(code, env, ctx) {
  const url = `${API}?location_id=${code}&type=FUELING&business_type=RETAIL`;
  const cacheKey = new Request(`https://cache.essence-alerts/total/${code}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit.json();
  let fuels = null;
  try {
    const res = await fetch(url, { headers: { 'api-key': env.TE_API_KEY, Referer: 'https://locator.totalenergies.com/' } });
    if (res.ok) {
      fuels = {};
      for (const p of (await res.json()).products_and_services || []) {
        const name = PRODUCTS[p.product_code];
        if (p.category_code !== 'ENERGIES' || !name || p.price === null) continue;
        if (name === 'Gazole' && fuels.Gazole && p.product_code === 'B10') continue;
        fuels[name] = p.availability_status || 'UNKNOWN';
      }
    }
  } catch {}
  const body = JSON.stringify(fuels);
  ctx?.waitUntil(caches.default.put(cacheKey, new Response(body, { headers: { 'Cache-Control': `max-age=${CACHE_SECONDS}` } })));
  return fuels;
}

export async function totalStatus(codes, env, ctx) {
  const list = [...new Set(codes)].filter(c => /^NF\d{6}$/.test(c)).slice(0, MAX_CODES);
  const out = {};
  await Promise.all(list.map(async c => { out[c] = await station(c, env, ctx); }));
  return out;
}
