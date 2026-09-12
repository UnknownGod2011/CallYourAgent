"use client";

import { useState } from "react";
import { Check, Copy, Link2, Send, ShieldCheck } from "lucide-react";
import { connectionPrompt, connectionSetups, type ConnectionHost } from "@/lib/connection-setup";

export function AgentConnection({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [host, setHost] = useState<ConnectionHost>("codex");
  const [token, setToken] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = typeof window === "undefined" ? "https://callyouragent.vercel.app/mcp" : `${window.location.origin}/mcp`;
  const setup = connectionSetups[host];
  const config = token ? setup.config(endpoint, token) : "Create a connection to reveal its private configuration.";
  const completeSetup = token ? connectionPrompt(host, endpoint, token) : "";

  async function copy(value: string, label: string) { await navigator.clipboard.writeText(value); setNotice(`${label} copied to your clipboard.`); }
  async function connect() { setBusy(true); setError(undefined); setNotice(undefined); const r = await fetch(`/api/agents/${agentId}/connection`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host }) }); const body = await r.json(); setBusy(false); if (!r.ok) { setError(body.error || "Could not create connection."); return; } setToken(body.token); setNotice("Connection created. Copy it now; this token is shown only once."); }
  async function disconnect() { setBusy(true); const r = await fetch(`/api/agents/${agentId}/connection`, { method: "DELETE" }); setBusy(false); if (!r.ok) { setError("Could not revoke connection."); return; } setToken(undefined); setNotice("Connection revoked. The previous token can no longer make calls."); }
  async function send() { if (!message.trim()) return; setBusy(true); setError(undefined); const r = await fetch(`/api/agents/${agentId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: message }) }); const body = await r.json(); setBusy(false); if (!r.ok) { setError(body.error || "Could not queue the update."); return; } setMessage(""); setNotice("Update queued. Your agent receives it the next time it calls pull_human_updates."); }

  return <section className="panel connection-panel"><div className="section-heading"><div><h2>Connect an external agent</h2><p>One private connection for {agentName}. CALL-E credits stay on your account.</p></div><Link2 size={18}/></div><div className="connection-body"><label>Where will you use this agent?<select value={host} onChange={e => { setHost(e.target.value as ConnectionHost); setToken(undefined); setNotice(undefined); }}><option value="codex">Codex CLI / IDE</option><option value="claude-code">Claude Code</option><option value="gemini-cli">Gemini CLI</option><option value="kiro">Kiro</option><option value="antigravity">Antigravity</option><option value="chatgpt-web">ChatGPT web / Work — unavailable</option><option value="generic">Any other IDE / custom agent</option></select></label><p className="form-hint">{setup.location} {setup.support === "pending" ? "Choose a supported client or generic MCP client instead." : "The token is scoped to this agent and can be revoked here."}</p>{setup.support === "pending" ? <p className="form-message">ChatGPT web and ChatGPT Work require a published OAuth app. This release does not expose that integration.</p> : <><div className="form-actions">{!token ? <button type="button" className="button button-primary" disabled={busy} onClick={connect}><ShieldCheck size={16}/>{busy ? "Creating…" : "Create connection"}</button> : <><button type="button" className="button button-secondary" onClick={() => copy(config, "Technical configuration")}><Copy size={16}/>Copy technical configuration</button><button type="button" className="button button-secondary" onClick={() => copy(completeSetup, "Complete setup prompt")}><Copy size={16}/>Copy complete setup prompt</button><button type="button" className="button button-quiet danger" disabled={busy} onClick={disconnect}>Revoke connection</button></>}</div>{token && <><pre className="connection-config" aria-label="MCP configuration">{config}</pre><p className="form-hint">{setup.verify}</p></>}</>}<div className="message-box"><label>Send your agent an update<textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="For the homepage, use the blue direction and keep the layout minimal." maxLength={4000}/></label><button type="button" className="button button-secondary" disabled={busy || !message.trim()} onClick={send}><Send size={15}/>Send update</button></div>{notice && <p className="connection-notice"><Check size={15}/>{notice}</p>}{error && <p className="form-message">{error}</p>}</div></section>;
}
