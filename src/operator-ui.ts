export function operatorConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CallYourAgent Operator</title>
  <style>
    :root { color-scheme:dark; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#07111f; color:#e7eef9; }
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
    input,textarea,button { width:100%; border-radius:10px; border:1px solid #29486d; background:#091829; color:#e7eef9; padding:11px 12px; font:inherit; }
    textarea { min-height:82px; resize:vertical; }
    button { cursor:pointer; border:0; background:#2e6fe7; font-weight:700; margin-top:12px; }
    button.secondary { background:#173150; }
    button:disabled { opacity:.5; cursor:not-allowed; }
    .status { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:14px; }
    .metric { padding:12px; background:#091829; border-radius:12px; min-height:78px; }
    .metric b { display:block; margin-top:6px; overflow-wrap:anywhere; }
    .branch-story { margin-top:14px; padding:14px; border:1px solid #29486d; border-radius:14px; background:linear-gradient(135deg,rgba(46,111,231,.11),rgba(9,24,41,.86)); }
    .branch-story-head { display:flex; justify-content:space-between; gap:10px; align-items:center; margin-bottom:10px; }
    .branch-lanes { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:10px; align-items:stretch; }
    .branch-lane { background:#091829; border-radius:12px; padding:12px; border:1px solid #1d3858; }
    .branch-lane b { display:block; margin:5px 0; overflow-wrap:anywhere; }
    .branch-lane small { display:block; color:#91a2b8; line-height:1.4; }
    .branch-lane.running { border-color:#2f705b; }
    .branch-lane.waiting { border-color:#7b6235; }
    .branch-lane.resumed { border-color:#397c78; }
    .branch-arrow { align-self:center; color:#8fb6ff; font-size:22px; font-weight:800; }
    .capability { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:12px 0 0; padding:10px 12px; background:#091829; border-radius:12px; }
    .badge { display:inline-flex; align-items:center; border:1px solid #29486d; border-radius:999px; padding:4px 8px; font-size:11px; font-weight:700; }
    .badge.owner { color:#88e5b7; border-color:#3a7b66; }
    .badge.readonly { color:#ffd88f; border-color:#7b6235; }
    .legend { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0 14px; }
    .legend-item,.event-stage { display:inline-flex; align-items:center; gap:6px; border:1px solid #29486d; border-radius:999px; padding:4px 8px; font-size:11px; font-weight:700; letter-spacing:.02em; }
    .timeline { display:flex; flex-direction:column; gap:10px; max-height:640px; overflow:auto; padding-right:4px; }
    .event { --stage:#2e6fe7; border-left:3px solid var(--stage); background:#091829; border-radius:0 12px 12px 0; padding:11px 13px; }
    .event[data-stage="decision-request"] { --stage:#ffb86b; } .event[data-stage="call"] { --stage:#8fb6ff; } .event[data-stage="decision"] { --stage:#88e5b7; }
    .event[data-stage="callback"] { --stage:#caa8ff; } .event[data-stage="steering"] { --stage:#ffd88f; } .event[data-stage="acknowledged"] { --stage:#61d7c7; }
    .event-stage { color:var(--stage); border-color:color-mix(in srgb,var(--stage) 42%,#29486d); }
    .event-top { display:flex; gap:10px; justify-content:space-between; color:#9eb0c8; font-size:12px; }
    .event-heading { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:6px 0; }
    .event-heading strong { display:block; }
    .error { color:#ff9a9a; min-height:22px; margin-top:10px; white-space:pre-wrap; }
    .ok { color:#88e5b7; } .warning { color:#ffd88f; } code { color:#b9d2ff; }
    @media (max-width:800px) { .grid { grid-template-columns:1fr; } header { align-items:flex-start; flex-direction:column; } .branch-lanes { grid-template-columns:1fr; } .branch-arrow { transform:rotate(90deg); justify-self:center; } }
  </style>
</head>
<body>
<main>
  <header>
    <div><div class="tag">Human escalation control plane</div><h1>CallYourAgent</h1><div class="muted">Active work, branch-level blocking, pending steering, and durable audit history. No duplicate state layer.</div></div>
    <div class="muted">Token stays in this browser tab and is sent only as an Authorization header.</div>
  </header>
  <div class="grid">
    <section class="card">
      <h2>Connect</h2>
      <label for="token">Scoped API token</label><input id="token" type="password" autocomplete="off" placeholder="agent / owner scoped token" />
      <label for="runId">Run ID</label><input id="runId" autocomplete="off" placeholder="run id" />
      <button id="refresh">Load run</button>
      <div id="message" class="error"></div>
      <div id="capability" class="capability" hidden><span class="muted">Credential</span><span id="credentialBadge" class="badge readonly">Not loaded</span><span id="credentialId" class="muted"></span></div>
      <div id="status" class="status" hidden>
        <div class="metric"><span class="muted">Run</span><b id="runStatus"></b></div>
        <div class="metric"><span class="muted">Active scope</span><b id="scope"></b></div>
        <div class="metric"><span class="muted">Blocked scopes</span><b id="blockedScopes"></b></div>
        <div class="metric"><span class="muted">Pending steering</span><b id="steeringCount"></b></div>
        <div class="metric" style="grid-column:1/-1"><span class="muted">Agent summary</span><b id="summary"></b></div>
        <div class="metric"><span class="muted">Updated</span><b id="updated"></b></div>
        <div class="metric"><span class="muted">Audit events</span><b id="eventCount"></b></div>
      </div>
      <p id="scopeNote" class="muted" hidden style="margin:12px 0 0"></p>
      <div id="branchStory" class="branch-story" hidden>
        <div class="branch-story-head"><div><div class="tag">Branch-safe execution</div><strong id="branchStoryTitle">Human judgment without freezing the run</strong></div><span id="branchStoryBadge" class="badge readonly">Waiting</span></div>
        <div class="branch-lanes">
          <div id="independentLane" class="branch-lane running"><span class="muted">Independent work</span><b id="independentStory">—</b><small id="independentDetail"></small></div>
          <div class="branch-arrow" aria-hidden="true">→</div>
          <div id="decisionLane" class="branch-lane waiting"><span class="muted">Owner-gated branch</span><b id="decisionStory">—</b><small id="decisionDetail"></small></div>
        </div>
      </div>
      <hr style="border:0;border-top:1px solid #24405f;margin:22px 0" />
      <h2>Request owner callback</h2>
      <p class="muted">Requires <code>owner:callback</code>. Capability discovery controls this button for clarity; the server independently enforces the scope.</p>
      <label for="prompt">Optional prompt</label><textarea id="prompt" placeholder="What should the agent brief you on?"></textarea>
      <button id="callback" class="secondary" disabled>Call me about this run</button>
      <div id="callbackAccess" class="muted" style="margin-top:10px">Load a run with an owner-scoped credential to enable callbacks.</div>
      <div id="callbackResult" class="muted" style="margin-top:8px"></div>
    </section>
    <section class="card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><div class="tag">Causal timeline</div><h2 style="margin:5px 0 0">What actually happened</h2></div><button id="auto" class="secondary" style="width:auto;margin:0">Auto refresh: off</button></div>
      <p class="muted">Every card is a persisted metadata-only event. Stage labels make the human loop visible without exposing decision answers, callback transcripts, or owner instruction text.</p>
      <div class="legend" aria-label="Timeline stages"><span class="legend-item">Needs owner</span><span class="legend-item">Phone call</span><span class="legend-item">Decision</span><span class="legend-item">Callback</span><span class="legend-item">Steering queued</span><span class="legend-item">Steering acknowledged</span></div>
      <div id="timeline" class="timeline"><div class="muted">Load a run to view its timeline.</div></div>
    </section>
  </div>
</main>
<script>
(() => {
  const byId = (id) => document.getElementById(id);
  let timer;
  const auth = () => ({ authorization:'Bearer ' + byId('token').value.trim(), 'content-type':'application/json' });
  const request = async (path, init = {}) => {
    const response = await fetch(path, { ...init, headers:{ ...auth(), ...(init.headers || {}) } });
    const text = await response.text();
    let value; try { value = text ? JSON.parse(text) : null; } catch { value = { error:text || response.statusText }; }
    if (!response.ok) throw new Error((value && (value.error || value.message)) || ('HTTP ' + response.status));
    return value;
  };
  const resetCapabilities = () => {
    byId('callback').disabled = true;
    byId('capability').hidden = true;
    byId('credentialBadge').textContent = 'Not loaded';
    byId('credentialBadge').className = 'badge readonly';
    byId('credentialId').textContent = '';
    byId('callbackAccess').textContent = 'Load a run with an owner-scoped credential to enable callbacks.';
  };
  const applyCapabilities = (capabilities) => {
    const scopes = Array.isArray(capabilities.scopes) ? capabilities.scopes : [];
    const canCallback = scopes.includes('owner:callback');
    byId('capability').hidden = false;
    byId('credentialBadge').textContent = canCallback ? 'Owner callback enabled' : 'Read-only';
    byId('credentialBadge').className = 'badge ' + (canCallback ? 'owner' : 'readonly');
    byId('credentialId').textContent = capabilities.credentialId ? '· ' + capabilities.credentialId : '';
    byId('callback').disabled = !canCallback;
    byId('callbackAccess').textContent = canCallback
      ? 'This credential may request owner callbacks. Agent-write and reconciliation permissions remain separate.'
      : 'Read-only credential: callback creation is disabled. Use a separately scoped owner credential to request a call.';
  };
  const renderBranchStory = (run, blocked, events) => {
    const currentScope = run.currentScope || 'No active scope reported';
    const activeIndependent = Boolean(run.currentScope && !blocked.includes(run.currentScope));
    const hasResolvedDecision = events.some((event) => event.type === 'owner_decision_recorded');
    byId('branchStory').hidden = false;
    byId('independentStory').textContent = currentScope;
    byId('independentDetail').textContent = activeIndependent && blocked.length
      ? 'Kept running while another branch waited for owner judgment.'
      : 'Current work reported by the agent control plane.';
    if (blocked.length) {
      byId('branchStoryTitle').textContent = 'Human judgment without freezing unrelated work';
      byId('branchStoryBadge').textContent = 'Independent work kept running';
      byId('branchStoryBadge').className = 'badge owner';
      byId('decisionLane').className = 'branch-lane waiting';
      byId('decisionStory').textContent = blocked.join(', ');
      byId('decisionDetail').textContent = 'Only this owner-gated scope is blocked; the active scope remains separate.';
      return;
    }
    byId('decisionLane').className = 'branch-lane resumed';
    byId('decisionStory').textContent = hasResolvedDecision && run.currentScope ? run.currentScope : 'No branch waiting';
    byId('decisionDetail').textContent = hasResolvedDecision && run.currentScope
      ? 'Owner decision is durably recorded; the run now reports this scope as active with no blocked scopes.'
      : 'No unresolved owner-gated scope is currently blocking the run.';
    byId('branchStoryTitle').textContent = hasResolvedDecision ? 'Owner-gated work is clear to continue' : 'No owner-gated branch is blocking';
    byId('branchStoryBadge').textContent = hasResolvedDecision ? 'Blocked branch resumed' : 'No branch blocked';
    byId('branchStoryBadge').className = 'badge owner';
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const eventStage = (type) => {
    if (type === 'escalation_created' || type === 'call_policy_deferred' || type === 'call_policy_released') return { id:'decision-request', label:'Needs owner' };
    if (type === 'call_attempt_created' || type === 'call_attempt_started' || type === 'call_attempt_ambiguous' || type === 'call_attempt_stalled' || type === 'call_attempt_completed' || type === 'call_attempt_failed' || type === 'call_attempt_canceled' || type === 'call_recovery_scheduled' || type === 'call_recovery_exhausted') return { id:'call', label:'Phone call' };
    if (type === 'owner_decision_recorded' || type === 'escalation_expired') return { id:'decision', label:'Decision' };
    if (type === 'owner_callback_requested') return { id:'callback', label:'Callback' };
    if (type === 'owner_instruction_queued') return { id:'steering', label:'Steering queued' };
    if (type === 'owner_instruction_consumed') return { id:'acknowledged', label:'Steering acknowledged' };
    return { id:'system', label:'Agent / system' };
  };
  const renderEvent = (event) => {
    const stage = eventStage(event.type);
    return '<article class="event" data-stage="' + escapeHtml(stage.id) + '"><div class="event-top"><span>#' + event.sequence + ' · ' + escapeHtml(event.actor) + '</span><time>' + escapeHtml(new Date(event.createdAt).toLocaleTimeString()) + '</time></div><div class="event-heading"><span class="event-stage">' + escapeHtml(stage.label) + '</span><strong>' + escapeHtml(event.type) + '</strong></div><div>' + escapeHtml(event.summary) + '</div></article>';
  };
  const load = async () => {
    const runId = byId('runId').value.trim();
    byId('message').textContent = '';
    if (!runId || !byId('token').value.trim()) { resetCapabilities(); byId('message').textContent = 'Token and run ID are required.'; return; }
    try {
      const [capabilities, overview, audit] = await Promise.all([
        request('/v1/auth/capabilities'),
        request('/v1/runs/' + encodeURIComponent(runId) + '/overview'),
        request('/v1/runs/' + encodeURIComponent(runId) + '/audit?limit=250'),
      ]);
      applyCapabilities(capabilities);
      const run = overview.run;
      const blocked = overview.unresolvedBlockingScopes || [];
      byId('status').hidden = false;
      byId('runStatus').textContent = run.status;
      byId('scope').textContent = run.currentScope || '—';
      byId('blockedScopes').textContent = blocked.length ? blocked.join(', ') : 'None';
      byId('steeringCount').textContent = String(overview.queuedInstructionCount ?? 0);
      byId('summary').textContent = run.summary;
      byId('updated').textContent = new Date(run.updatedAt).toLocaleString();
      byId('eventCount').textContent = audit.events.length;
      const activeIndependent = run.currentScope && !blocked.includes(run.currentScope);
      byId('scopeNote').hidden = false;
      byId('scopeNote').className = activeIndependent && blocked.length ? 'warning' : 'muted';
      byId('scopeNote').textContent = activeIndependent && blocked.length
        ? 'Independent work is still active while ' + blocked.length + ' blocked scope' + (blocked.length === 1 ? ' waits.' : 's wait.')
        : blocked.length ? blocked.length + ' scope' + (blocked.length === 1 ? ' is' : 's are') + ' waiting for owner resolution.' : 'No scope is currently blocked on owner judgment.';
      renderBranchStory(run, blocked, audit.events);
      byId('timeline').innerHTML = audit.events.slice().reverse().map(renderEvent).join('') || '<div class="muted">No audit events yet.</div>';
      byId('message').textContent = 'Connected'; byId('message').className = 'error ok';
    } catch (error) { resetCapabilities(); byId('message').className = 'error'; byId('message').textContent = error.message; }
  };
  byId('token').addEventListener('input', resetCapabilities);
  byId('refresh').addEventListener('click', load);
  byId('callback').addEventListener('click', async () => {
    if (byId('callback').disabled) return;
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
  resetCapabilities();
})();
</script>
</body>
</html>`;
}