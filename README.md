# OpenJar by Guti AI Labs

A small, self-hosted alternative for the **heatmap part of Hotjar**. Click maps,
scroll depth, section reach, and named action counts live in your own SQLite / D1
database. This first release does **not** provide session replay, surveys,
cross-page funnels, cross-visit identity, or Hotjar feature parity.

MIT licensed. The dashboard uses the MIT-licensed [heatmap.js 2.0.5](https://github.com/pa7/heatmap.js)
renderer; its original license is in `dashboard/vendor/heatmap-LICENSE`. Guti's
foundation token and component CSS are included. No landing artwork, account
configuration, credentials, or visitor data are included in this repository.

## Integrate

No external analytics service is required. Node 22.13+ is needed for the test
suite. Run `npm test`.

1. Put `data-openjar-section="hero"` (and other approved section names) on page
   sections, and `data-openjar-target="waitlist"` on named actions. Mark sensitive
   custom regions with `data-openjar-ignore`. Native input, textarea, select and
   contenteditable regions are always excluded.
2. Import `startOpenJar` from `tracker.mjs`, pass a layout revision and explicit
   allowlists, and retain the returned cleanup function. Initialize once per
   page load, **after your existing consent decision allows analytics**. Invoke
   cleanup when consent is revoked. Guti also provides a local analytics
   preference and respects DNT / Global Privacy Control.

```js
const config = {
  revision: 'home-v1',
  sections: ['hero', 'story', 'worlds', 'how'],
  targets: ['waitlist', 'login'],
  labels: { hero: 'Introduction', story: 'Story', worlds: 'Product', how: 'How it works' },
  previewPath: '/openjar/preview',
};
const stop = startOpenJar(config);
```

3. Route `/api/openjar/collect` to `collect(request, env.DB, config)`. Put
   `/api/openjar/report` **behind server-side owner authorization**, then call
   `report(request, env.DB, config)`. `isOwner` is an optional adapter for ChatGPT
   Sites' authenticated identity headers and a server-only `OPENJAR_OWNER_EMAIL`
   environment value. **Do not trust these headers on other hosts**; replace
   this adapter with your host's session checks. Never make reports public or
   put a token in client code.
4. Serve `dashboard/` at `/openjar/` and config as `/openjar/config.json`. Supply a
   **static HTML snapshot** of the current landing at `previewPath`, with the
   section attributes and matching CSS, but no tracking or app scripts. Keep it
   on the same origin. The supplied preview adapter expects a `hero` section.
   Set the dashboard sign-in link to your host's sign-in flow (default: Sites).
5. The collector creates its own `openjar_events` table and day index lazily.
   For migration-managed databases, apply `SCHEMA` and its index during deployment
   instead. Never mix both lifecycle models for the same table.
6. Bump `revision` when section anatomy changes. Reports filter to the current
   revision so unrelated layouts are never overlaid together.

## Data dictionary

| Field | Meaning |
| --- | --- |
| `view_id` | Random in-memory UUID for one page load, never a persistent visitor ID |
| `sequence` | Event sequence 0–199; deduplication key within a page view |
| `revision` | Configured layout version |
| `device` | Mobile <600px, tablet <1000px, otherwise desktop |
| `kind` | View, click, keyboard action, section reach, or scroll threshold |
| `section`, `target` | Allowlisted identifiers, never element text or selectors |
| `x`, `y` | Coarse section-relative grid cell (50 × 100), or scroll milestone |
| `day` | Server UTC day |

No cookies, fingerprinting, IP storage, URL/query capture, form values, text
content, DOM snapshots, or session recordings. Infrastructure providers can have
separate request logs. Unexpected fields are rejected before writes. DNT/GPC
and `?openjar_optout` suppress this tracker. The application owns consent/UI
policy; this library does not change other tags already on a site.

## Interpretation and limits

- Views mean recorded page loads, not unique people. Reloads count again.
- A waitlist action means a click/keyboard activation, not a saved signup.
- Scroll depth measures the viewport's bottom reaching 25/50/75/100% of the page.
  Reach means a section entered the viewport. Neither proves reading.
- Click positions are normalized by section; preview widths are 390/768/1280px.
  Responsive variation within a device group affects precise alignment. Keyboard
  actions have no fabricated pointer position.
- A page sends at most 200 events, in batches of 20, without a persistent retry
  queue. Failed, blocked, offline or interrupted requests may reduce coverage.
- Primary keys deduplicate retries. Same-origin JSON ingestion has an 8KiB limit
  but is not proof of a human visit. Use host rate limits for high traffic or
  abuse. These metrics are not suitable for billing.
- Reports cover up to 30 days. Older data is removed on the next accepted
  collection request; schedule cleanup if deletion during no-traffic periods is
  required. Landing signup and notification tables are separate.
- Empty data stays empty; no demo events are inserted in production.

## Verification

`npm test` checks tracker exclusions and budgets, real SQLite aggregation,
deduplication, retention, owner authorization, input limits and storage failures.
A consuming app should also test routing, its static preview, signup and email
flows. Use browser checks for responsive placement, keyboard focus, opt-out and
canvas rendering. The collector, dashboard and reports must be checked together.
