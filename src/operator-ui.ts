export function operatorConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CallYourAgent Operator</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#07111f; color:#e7eef9; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at top,#102441 0,#07111f 45%,#050b14 100%); }
    main { width:min(1100px,94vw); margin:0 auto; padding:40px 0 64px; }
    header { display:flex; gap:18px; justify-content:space-between; align-items:flex-end; margin-bottom:24px; }
    h1 { margin:0; font-size:clamp(28px,5vw,48px); letter-spacing:-.04em; }
    .tag { color:#8fb6ff; font-weight:700; text-transform:uppercase; font-size:12px; letter-spacing:.14em; }
    .muted { color:#91a2b8; }
    .grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.35fr); gap:18px; }
    .card { background:rgba(11,27,47,.86); border:1px solid rgba(143,182,255,.18); border-radius:18px; padding:20px; box-shadow:0 18px 50px rgba(0,0,0,.22); }
    label { display:block; font-size:12px; color:#9eb0c8; margin:12px 0 6px; }
    input, textarea, button { width:100%; border-radius:10px; border:1px solid #29486d; background:#091829; color:#e7eef9; padding:11px 12px; font:inherit; }
    textarea { min-height:82px; resize:vertical; }
    button { cursor:pointer; border:0; background:#2e6fe7; font-weight:700; margin-top:12px; }
    button.secondary { background:#173150; }
    button:disabled { opacity:.55; cursor:not-allowed; }
    .status { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:14px; }
    .metric { padding:12px; background:#091829; border-radius:12px; min-height:78px; }
    .metric b { display:block; margin-top:6px; overflow-wrap:anywhere; }
    .timeline { display:flex; flex-direction:column; gap:10px; max-height:640px; overflow:auto; padding-right:4px; }
    .event { border-left:3px solid #2e6fe7; background:#091829; border-radius:0 12px 12px 0; padding:11px 13px; }
    .event-top { display:flex; gap:10px; justify-content:space-between; color:#9eb0c8; font-size:12px; }
    .event strong { display:block; margin:5px 0; }
    .error { color:#ff9a9a; min-height:22px; margin-top:10px; white-space:pre-wrap; }
    .ok { color:#88e5b7; }
    code { color:#b9d2ff; }
    @media (max-width:800px) { .grid { grid-template-columns:1fr; } header { align-items:flex-start; flex-direction:column; } }
  </style>
</head>
<body>
<main>
  <header>
    <div><div class="tag">Human escalation control plane</div><h1>CallYourAgent</h1><div class="muted">Live run status and durable audit history. No duplicate state layer.</div></div>
    <div class="muted">Token stays in this browser tab and is sent only as an Authorization header.</div>
  </header>
  <div class="grid">
    <section class="card">
      <h2>Connect</h2>
      <label for="token">Scoped API token</label><input id="token" type="password" autocomplete="off" placeholder="agent / owner scoped token" />
      <label for="runId">Run ID</label><input id="runId" autocomplete="off" placeholder="run id" />
      <button id="refresh">Load run</button>
      <div id="message" class="error"></div>
      <div id="status" class="status" hidden>
        <div class="metric"><span class="muted">Run</span><b id="runStatus"></b></div>
        <div class="metric"><span class="muted">Current scope</span><b id="scope"></b></div>
        <div class="metric" style="grid-column:1/-1"><span class="muted">Agent summary</span><b id="summary"></b></div>
        <div class="metric"><span class="muted">Updated</span><b id="updated"></b></div>
        <div class="metric"><span class="muted">Audit events</span><b id="eventCount"></b></div>
      </div>
      <hr style="border:0;border-top:1px solid #24405f;margin:22px 0" />
      <h2>Request owner callback</h2>
      <p class="muted">Requires an <code>owner:callback</code> credential. The callback receives the current run context; resulting steering enters the durable instruction queue.</p>
      <label for="prompt">Optional prompt</label><textarea id="prompt" placeholder="What should the agent brief you on?"></textarea>
      <button id="callback" class="secondary">Call me about this run</button>
      <div id="callbackResult" class="muted" style="margin-top:10px"></div>
    </section>
    <section class="card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><div class="tag">Causal timeline</div><h2 style="margin:5px 0 0">What actually happened</h2></div><button id="auto" class="secondary" style="width:auto;margin:0">Auto refresh: off</button></div>
      <p class="muted">Shows persisted operational events such as policy deferral, calls, decisions, branch resume, callbacks, queued steering, and checkpoint consumption.</p>
      <div id="timeline" class="timeline"><div class="muted">Load a run to view its timeline.</div></div>
    </section>
  </div>
</main>
<script>
(() => {
  const byId = (id) => document.getElementById(id);
  let timer;
  const auth = () => ({ authorization: 'Bearer ' + byId('token').value.trim(), 'content-type': 'application/json' });
  const request = async (path, init = {}) => {
    const response = await fetch(path, { ...init, headers: { ...auth(), ...(init.headers || {}) } });
    const text = await response.text();
    let value; try { value = text ? JSON.parse(text) : null; } catch { value = { error: text || response.statusText }; }
    if (!response.ok) throw new Error((value && (value.error || value.message)) || ('HTTP ' + response.status));
    return value;
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const load = async () => {
    const runId = byId('runId').value.trim();
    byId('message').textContent = '';
    if (!runId || !byId('token').value.trim()) { byId('message').textContent = 'Token and run ID are required.'; return; }
    try {
      const [run, audit] = await Promise.all([
        request('/v1/runs/' + encodeURIComponent(runId)),
        request('/v1/runs/' + encodeURIComponent(runId) + '/audit?limit=250'),
      ]);
      byId('status').hidden = false;
      byId('runStatus').textContent = run.status;
      byId('scope').textContent = run.currentScope || '—';
      byId('summary').textContent = run.summary;
      byId('updated').textContent = new Date(run.updatedAt).toLocaleString();
      byId('eventCount').textContent = audit.events.length;
      byId('timeline').innerHTML = audit.events.slice().reverse().map((event) => '<article class="event"><div class="event-top"><span>#' + event.sequence + ' · ' + escapeHtml(event.actor) + '</span><time>' + escapeHtml(new Date(event.createdAt).toLocaleTimeString()) + '</time></div><strong>' + escapeHtml(event.type) + '</strong><div>' + escapeHtml(event.summary) + '</div></article>').join('') || '<div class="muted">No audit events yet.</div>';
      byId('message').textContent = 'Connected'; byId('message').className = 'error ok';
    } catch (error) { byId('message').className = 'error'; byId('message').textContent = error.message; }
  };
  byId('refresh').addEventListener('click', load);
  byId('callback').addEventListener('click', async () => {
    const runId = byId('runId').value.trim();
    byId('callbackResult').textContent = '';
    if (!runId || !byId('token').value.trim()) { byId('callbackResult').textContent = 'Token and run ID are required.'; return; }
    try {
      const result = await request('/v1/callbacks', { method:'POST', body:JSON.stringify({ runId, prompt:byId('prompt').value.trim() || undefined, idempotencyKey:'operator-' + runId + '-' + crypto.randomUUID() }) });
      byId('callbackResult').textContent = 'Callback queued: ' + result.id + ' (' + result.status + ')';
      await load();
    } catch (error) { byId('callbackResult').textContent = error.message; }
  });
  byId('auto').addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = undefined; byId('auto').textContent = 'Auto refresh: off'; return; }
    timer = setInterval(load, 3000); byId('auto').textContent = 'Auto refresh: 3s'; load();
  });
})();
</script>
</body>
</html>`;
}
