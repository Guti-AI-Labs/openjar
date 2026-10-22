// OpenJar by Guti AI Labs. MIT licensed. No DOM snapshots or input values.
export function startOpenJar({ revision, sections, targets, endpoint = '/api/openjar/collect', window: win = window }) {
  const doc = win.document;
  if (win.top !== win.self || win.navigator.doNotTrack === '1' || win.navigator.globalPrivacyControl === true ||
      new URLSearchParams(win.location.search).has('openjar_optout')) return () => {};
  const view = win.crypto.randomUUID();
  const device = win.innerWidth < 600 ? 'mobile' : win.innerWidth < 1000 ? 'tablet' : 'desktop';
  const queue = [];
  const seen = new Set();
  let sequence = 0, stopped = false;
  const push = (kind, section = 'page', x = 0, y = 0, target = '') => {
    if (stopped || sequence >= 200) return;
    queue.push({ sequence: sequence++, kind, section, x, y, target });
    if (queue.length >= 20) flush();
  };
  function flush() {
    if (!queue.length) return;
    const events = queue.splice(0, 20);
    const body = JSON.stringify({ revision, view, device, events });
    // Failed analytics never block the page. No persistent retry buffer or cookies.
    win.fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
      credentials: 'omit' }).catch(() => {});
  }
  const click = event => {
    const element = event.target?.closest?.('*');
    if (!element || element.closest('input, textarea, select, [contenteditable], [data-openjar-ignore]')) return;
    const region = element.closest('[data-openjar-section]');
    const section = region?.dataset.openjarSection;
    if (!sections.includes(section)) return;
    const box = region.getBoundingClientRect();
    const named = element.closest('[data-openjar-target]')?.dataset.openjarTarget;
    const target = targets.includes(named) ? named : '';
    // Keyboard activations count as CTA actions without fabricated pointer coordinates.
    if (event.detail === 0) { if (target) push('action', section, 0, 0, target); return; }
    if (!box.width || !box.height) return;
    push('click', section, Math.max(0, Math.min(49, Math.floor((event.clientX - box.left) / box.width * 50))),
      Math.max(0, Math.min(99, Math.floor((event.clientY - box.top) / box.height * 100))), target);
  };
  const depth = () => {
    if (doc.visibilityState === 'hidden') return;
    const height = Math.max(doc.documentElement.scrollHeight, win.innerHeight);
    const percent = Math.min(100, (win.scrollY + win.innerHeight) / height * 100);
    for (const value of [25, 50, 75, 100]) {
      if (percent >= value - 0.5 && !seen.has(`depth-${value}`)) {
        seen.add(`depth-${value}`); push('scroll', 'page', 0, value);
      }
    }
    for (const id of sections) {
      const region = doc.querySelector(`[data-openjar-section="${id}"]`);
      const box = region?.getBoundingClientRect();
      if (box && box.top < win.innerHeight * 0.8 && box.bottom > 0 && !seen.has(id)) {
        seen.add(id); push('reach', id);
      }
    }
  };
  let frame = 0;
  const scroll = () => { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; depth(); }); };
  const hidden = () => { if (doc.visibilityState === 'hidden') flush(); else depth(); };
  push('view');
  // Wait for images and fonts before measuring the page's depth.
  const loaded = () => { depth(); flush(); };
  if (doc.readyState === 'complete') loaded(); else win.addEventListener('load', loaded, { once: true });
  doc.addEventListener('click', click, { passive: true });
  win.addEventListener('scroll', scroll, { passive: true });
  win.addEventListener('resize', scroll, { passive: true });
  win.addEventListener('pagehide', flush);
  doc.addEventListener('visibilitychange', hidden);
  const timer = win.setInterval(flush, 5000);
  return () => {
    stopped = true; flush(); win.clearInterval(timer); win.cancelAnimationFrame(frame);
    doc.removeEventListener('click', click); win.removeEventListener('scroll', scroll);
    win.removeEventListener('resize', scroll); win.removeEventListener('pagehide', flush);
    doc.removeEventListener('visibilitychange', hidden); win.removeEventListener('load', loaded);
  };
}
