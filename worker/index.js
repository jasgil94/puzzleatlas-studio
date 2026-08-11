// Cloudflare Worker entry point for ClueAtlas Studio.
//
// This site is deployed as a Worker with static assets (not a classic
// Pages project — check `wrangler.jsonc` at the repo root), so there's no
// Pages Functions file-routing here. Instead this one fetch handler owns
// the small JSON API the app's "Cloud Backup" feature relies on (see
// CloudSync in app.js) under /api/hunts and /api/hunts/:id, backed by the
// HUNTS_KV binding, and defers every other request to the static site
// files (index.html, app.js, engine.js, styles.css, etc.) via the ASSETS
// binding. Static assets are matched before this Worker ever runs (that's
// the default Workers Assets routing behavior), so this code effectively
// only ever sees requests under /api/.
//
// Auth: a single shared secret, since this is a personal single-user
// backup store, not a multi-tenant service. The client sends it as the
// X-Backup-Key header; it's compared against the CLOUD_BACKUP_KEY secret,
// which must be set with `wrangler secret put CLOUD_BACKUP_KEY` or via the
// Cloudflare dashboard (Workers & Pages -> puzzleatlas-studio -> Settings
// -> Variables and Secrets) — it must never be committed to this repo.

function checkAuth(request, env) {
  var key = request.headers.get("X-Backup-Key") || "";
  var expected = env.CLOUD_BACKUP_KEY || "";
  return expected.length > 0 && key === expected;
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
}
function unauthorized() { return json({ error: "Unauthorized" }, 401); }

// GET /api/hunts — a lightweight index ({id, title, updatedAt} per hunt),
// not the full JSON, since a hunt can be a few MB once images are
// attached. Title/updatedAt are mirrored into KV metadata on every write
// (see handleHuntById's PUT branch) so this never has to read full values.
async function handleHuntsIndex(request, env) {
  if (!checkAuth(request, env)) return unauthorized();
  if (!env.HUNTS_KV) return json({ error: "HUNTS_KV binding is not configured on this Worker." }, 500);

  var items = [];
  var cursor;
  do {
    var page = await env.HUNTS_KV.list({ prefix: "hunt:", cursor: cursor });
    for (var i = 0; i < page.keys.length; i++) {
      var k = page.keys[i];
      var meta = k.metadata || {};
      items.push({ id: k.name.slice(5), title: meta.title || "Untitled Hunt", updatedAt: meta.updatedAt || null });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return json(items);
}

// /api/hunts/:id — GET the full hunt, PUT to upsert it, DELETE to remove it.
async function handleHuntById(request, env, id) {
  if (!checkAuth(request, env)) return unauthorized();
  if (!env.HUNTS_KV) return json({ error: "HUNTS_KV binding is not configured on this Worker." }, 500);

  if (request.method === "GET") {
    var value = await env.HUNTS_KV.get("hunt:" + id);
    if (value === null) return json({ error: "Not found" }, 404);
    return new Response(value, { headers: { "Content-Type": "application/json" } });
  }

  if (request.method === "PUT") {
    var bodyText = await request.text();
    var hunt;
    try { hunt = JSON.parse(bodyText); } catch (e) { return json({ error: "Body is not valid JSON." }, 400); }
    if (!hunt || typeof hunt !== "object" || !hunt.id) return json({ error: "Hunt JSON is missing an id." }, 400);
    if (hunt.id !== id) return json({ error: "URL id and hunt.id don't match." }, 400);
    var updatedAt = (hunt.metadata && hunt.metadata.updatedAt) || new Date().toISOString();
    await env.HUNTS_KV.put("hunt:" + id, bodyText, {
      metadata: { title: hunt.title || "Untitled Hunt", updatedAt: updatedAt }
    });
    return json({ ok: true, id: id, updatedAt: updatedAt });
  }

  if (request.method === "DELETE") {
    await env.HUNTS_KV.delete("hunt:" + id);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

// TEMPORARY diagnostic route for tracking down a "key rejected" report —
// reveals only whether CLOUD_BACKUP_KEY is bound and its length, never the
// value itself, so it's safe to leave reachable without auth while
// debugging. Remove this route (and the /api/debug-env check below) once
// cloud backup is confirmed working.
function handleDebugEnv(request, env) {
  var expected = env.CLOUD_BACKUP_KEY;
  return json({
    hasKey: typeof expected === "string" && expected.length > 0,
    keyLength: typeof expected === "string" ? expected.length : null,
    hasKvBinding: !!env.HUNTS_KV
  });
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);

    if (url.pathname === "/api/debug-env") {
      return handleDebugEnv(request, env);
    }
    if (url.pathname === "/api/hunts" && request.method === "GET") {
      return handleHuntsIndex(request, env);
    }
    var m = url.pathname.match(/^\/api\/hunts\/([^\/]+)$/);
    if (m) {
      return handleHuntById(request, env, decodeURIComponent(m[1]));
    }

    // Not an API route — hand off to the static site.
    return env.ASSETS.fetch(request);
  }
};
