const $ = id => document.getElementById(id);
let data, config, requestNumber = 0, frameReady = false;
const frame = $('page');
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
function row(label, count, total) {
  const item = document.createElement('div'); item.className = 'bar-row';
  const text = document.createElement('div'); text.className = 'bar-label';
  const name = document.createElement('span'); name.textContent = label;
  const value = document.createElement('span'); value.textContent = total ? `${Math.round(count / total * 100)}% · ${count}` : String(count);
  text.append(name, value); const bar = document.createElement('div'); bar.className = 'bar';
  const fill = document.createElement('span'); fill.style.width = `${total ? Math.min(100, count / total * 100) : 0}%`;
  bar.append(fill); item.append(text, bar); return item;
}
function render() {
  if (!data) return;
  const section = $('section').value;
  $('views').textContent = data.views.toLocaleString();
  const clicks = data.clicks.filter(p => p.section === section);
  $('clicks').textContent = clicks.reduce((n, p) => n + p.count, 0).toLocaleString();
  $('ctas').textContent = data.actions.filter(p => p.target === 'waitlist').reduce((n, p) => n + p.count, 0).toLocaleString();
  $('empty').hidden = clicks.length > 0;
  $('depth').replaceChildren(...[25, 50, 75, 100].map(value => row(`${value}% of page`, data.depth.find(p => p.depth === value)?.count || 0, data.views)));
  $('actions').replaceChildren(...config.sections.map(id => row(config.labels[id], data.actions.filter(p => p.section === id && p.target === 'waitlist').reduce((n, p) => n + p.count, 0), 0)));
  $('freshness').textContent = `Updated ${new Date(data.asOf).toLocaleString()} · Layout ${data.revision} · From ${data.since} (UTC)`;
  drawPreview();
}
function drawPreview() {
  if (!frameReady || !data) return;
  try {
    const doc = frame.contentDocument;
    const region = doc.querySelector(`[data-openjar-section="${$('section').value}"]`);
    if (!region) throw Error('Section unavailable');
    const width = { desktop: 1280, tablet: 768, mobile: 390 }[data.device];
    frame.style.width = `${width}px`;
    // Fix the hero's viewport-dependent minimum before expanding the frame.
    const hero = doc.querySelector('[data-openjar-section="hero"]');
    hero.style.minHeight = ''; hero.style.height = '';
    frame.style.height = `${data.device === 'desktop' ? 800 : 844}px`;
    const heroHeight = hero.getBoundingClientRect().height;
    hero.style.minHeight = `${heroHeight}px`;
    frame.style.height = `${Math.min(20000, doc.documentElement.scrollHeight + 1000)}px`;
    const box = region.getBoundingClientRect();
    const available = $('preview').parentElement.clientWidth - 48;
    const scale = Math.min(1, available / box.width);
    const w = Math.round(box.width * scale), h = Math.round(box.height * scale);
    $('preview').style.width = `${w}px`; $('preview').style.height = `${h}px`;
    frame.style.transform = `scale(${scale})`;
    frame.style.left = `${-box.left * scale}px`; frame.style.top = `${-box.top * scale}px`;
    $('heat').replaceChildren();
    if (!window.h337) throw Error('Heatmap renderer did not load');
    const heatmap = window.h337.create({ container: $('heat'), radius: 24, maxOpacity: 0.72, minOpacity: 0.06, blur: 0.85 });
    const points = data.clicks.filter(p => p.section === $('section').value);
    heatmap.setData({ max: Math.max(1, ...points.map(p => p.count)), data: points.map(p => ({ x: Math.round((p.x + .5) / 50 * w), y: Math.round((p.y + .5) / 100 * h), value: p.count })) });
  } catch { $('map-note').textContent = 'The page preview could not load. Counts and scroll depth are still available. Refresh to retry.'; }
}
async function load() {
  const current = ++requestNumber; $('refresh').disabled = true; $('export').disabled = true;
  status('Loading insights…');
  try {
    const response = await fetch(`/api/openjar/report?device=${$('device').value}&days=${$('days').value}`, { cache: 'no-store' });
    if (current !== requestNumber) return;
    if (response.status === 401 || response.status === 403) { $('auth').hidden = false; $('dashboard').hidden = true; return; }
    if (!response.ok) throw Error('Could not load insights. Please retry.');
    data = await response.json();
    if (current !== requestNumber) return;
    status(data.views ? 'Showing collected visitor activity.' : 'Collection is ready. No visitor data for this device and period yet.');
    render(); $('export').disabled = false;
  } catch (error) { if (current === requestNumber) status(error.message, true); }
  finally { if (current === requestNumber) $('refresh').disabled = false; }
}
$('filters').addEventListener('submit', event => { event.preventDefault(); load(); });
$('device').addEventListener('change', load); $('days').addEventListener('change', load);
$('section').addEventListener('change', render);
$('export').addEventListener('click', () => {
  if (!data) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `openjar-${data.device}-${data.since}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('theme').addEventListener('click', () => { const dark = document.documentElement.classList.toggle('dark'); $('theme').textContent = dark ? 'Light theme' : 'Dark theme'; });
window.addEventListener('resize', drawPreview);
try {
  const response = await fetch('/openjar/config.json'); if (!response.ok) throw Error('Configuration unavailable');
  config = await response.json();
  for (const id of config.sections) { const option = document.createElement('option'); option.value = id; option.textContent = config.labels[id]; $('section').append(option); }
  frame.addEventListener('load', async () => {
    if (frame.src === 'about:blank') return;
    const doc = frame.contentDocument;
    await doc.fonts.ready;
    // The preview endpoint contains a static render, not the tracking app.
    const images = [...doc.images]; images.forEach(img => img.loading = 'eager');
    await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); })));
    frameReady = true; drawPreview();
  });
  frame.src = config.previewPath;
  await load();
} catch { status('OpenJar could not start. Please refresh the page.', true); }
