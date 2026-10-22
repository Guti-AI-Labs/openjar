// OpenJar by Guti AI Labs. MIT licensed. D1 / SQLite adapter.
export const SCHEMA = `CREATE TABLE IF NOT EXISTS openjar_events (
  view_id TEXT NOT NULL, sequence INTEGER NOT NULL, revision TEXT NOT NULL,
  device TEXT NOT NULL, kind TEXT NOT NULL, section TEXT NOT NULL,
  x INTEGER NOT NULL, y INTEGER NOT NULL, target TEXT NOT NULL, day TEXT NOT NULL,
  PRIMARY KEY(view_id, sequence)
)`;
const INDEX = 'CREATE INDEX IF NOT EXISTS openjar_day ON openjar_events(day, revision, device)';
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
const exactKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' &&
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

export function validateBatch(body, config) {
  if (!exactKeys(body, ['revision', 'view', 'device', 'events']) || body.revision !== config.revision ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.view) ||
      !['mobile', 'tablet', 'desktop'].includes(body.device) || !Array.isArray(body.events) ||
      body.events.length < 1 || body.events.length > 20) return false;
  return body.events.every(e => {
    if (!exactKeys(e, ['sequence', 'kind', 'section', 'x', 'y', 'target']) ||
        !Number.isInteger(e.sequence) || e.sequence < 0 || e.sequence >= 200 ||
        !Number.isInteger(e.x) || !Number.isInteger(e.y) || typeof e.target !== 'string') return false;
    if (e.kind === 'view') return e.sequence === 0 && e.section === 'page' && e.x === 0 && e.y === 0 && e.target === '';
    if (e.kind === 'scroll') return e.section === 'page' && e.x === 0 && [25, 50, 75, 100].includes(e.y) && e.target === '';
    if (!config.sections.includes(e.section)) return false;
    if (e.kind === 'reach') return e.x === 0 && e.y === 0 && e.target === '';
    if (e.kind === 'action') return e.x === 0 && e.y === 0 && config.targets.includes(e.target);
    return e.kind === 'click' && e.x >= 0 && e.x < 50 && e.y >= 0 && e.y < 100 &&
      (e.target === '' || config.targets.includes(e.target));
  });
}

export async function ensureOpenJar(DB) {
  await DB.batch([DB.prepare(SCHEMA), DB.prepare(INDEX)]);
}

export async function collect(request, DB, config) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Origin not allowed.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON required.' }, 415);
  if (Number(request.headers.get('content-length')) > 8192) return json({ error: 'Payload too large.' }, 413);
  if (!DB) return json({ error: 'Storage unavailable.' }, 503);
  try {
    // Stream with a hard bound; never read an arbitrarily large anonymous body.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Invalid batch.' }, 400);
    const decoder = new TextDecoder(); let raw = '', bytes = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); return json({ error: 'Payload too large.' }, 413); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    const body = JSON.parse(raw);
    if (!validateBatch(body, config)) return json({ error: 'Invalid batch.' }, 400);
    await ensureOpenJar(DB);
    const day = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    await DB.batch([
      DB.prepare('DELETE FROM openjar_events WHERE day < ?').bind(cutoff),
      ...body.events.map(e => DB.prepare(`INSERT OR IGNORE INTO openjar_events
        (view_id, sequence, revision, device, kind, section, x, y, target, day)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(body.view, e.sequence, body.revision, body.device,
        e.kind, e.section, e.x, e.y, e.target, day)),
    ]);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return json({ error: error instanceof SyntaxError ? 'Invalid JSON.' : 'Could not save analytics.' }, error instanceof SyntaxError ? 400 : 503); }
}

// Only trust these identity headers behind Sites dispatch, which authenticates
// and strips client-supplied identity. Other hosts must supply their own auth.
export function isOwner(request, env) {
  return Boolean(env.OPENJAR_OWNER_EMAIL && request.headers.get('oai-authenticated-user-id') &&
    request.headers.get('oai-authenticated-user-email')?.toLowerCase() === env.OPENJAR_OWNER_EMAIL.toLowerCase());
}

export async function report(request, DB, config) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  if (!DB) return json({ error: 'Storage unavailable.' }, 503);
  const params = new URL(request.url).searchParams;
  const device = ['mobile', 'tablet', 'desktop'].includes(params.get('device')) ? params.get('device') : 'desktop';
  const days = [1, 7, 30].includes(Number(params.get('days'))) ? Number(params.get('days')) : 7;
  const cutoff = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  try {
    await ensureOpenJar(DB);
    const where = 'WHERE day >= ? AND revision = ? AND device = ?';
    const args = [cutoff, config.revision, device];
    const views = await DB.prepare(`SELECT COUNT(DISTINCT view_id) AS count FROM openjar_events ${where} AND kind = 'view'`).bind(...args).first();
    const clicks = await DB.prepare(`SELECT section, x, y, COUNT(*) AS count FROM openjar_events ${where} AND kind = 'click' GROUP BY section, x, y`).bind(...args).all();
    const actions = await DB.prepare(`SELECT section, target, COUNT(*) AS count FROM openjar_events ${where} AND kind IN ('click','action') AND target != '' GROUP BY section, target`).bind(...args).all();
    const reach = await DB.prepare(`SELECT section, COUNT(DISTINCT view_id) AS count FROM openjar_events ${where} AND kind = 'reach' GROUP BY section`).bind(...args).all();
    const depth = await DB.prepare(`SELECT y AS depth, COUNT(DISTINCT view_id) AS count FROM openjar_events ${where} AND kind = 'scroll' GROUP BY y ORDER BY y`).bind(...args).all();
    return json({ revision: config.revision, device, days, since: cutoff, asOf: new Date().toISOString(),
      views: views.count, clicks: clicks.results, actions: actions.results, reach: reach.results, depth: depth.results });
  } catch { return json({ error: 'Analytics are temporarily unavailable. Please retry.' }, 503); }
}
