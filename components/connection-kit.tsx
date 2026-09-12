"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { connectionHosts, connectionPrompt, connectionSetups, type ConnectionHost } from "@/lib/connection-setup";

const endpoint = "https://callyouragent.vercel.app/mcp";
const placeholderToken = "<PASTE_YOUR_PRIVATE_AGENT_CONNECTION_TOKEN>";

export function ConnectionKit() {
  const [host, setHost] = useState<ConnectionHost>("kiro");
  const [copied, setCopied] = useState(false);
  const setup = connectionSetups[host];
  const config = setup.config(endpoint, placeholderToken);

  async function copy() {
    await navigator.clipboard.writeText(connectionPrompt(host, endpoint));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return <div className="kit"><aside>{connectionHosts.map((key) => <button key={key} className={host === key ? "kit-host active" : "kit-host"} onClick={() => setHost(key)}>{connectionSetups[key].label}{connectionSetups[key].support === "pending" && <small>Not available</small>}</button>)}</aside><article><p className="eyebrow">{setup.label}</p><h2>{setup.support === "supported" ? "Technical setup" : "Availability"}</h2><p>{setup.location}</p>{setup.support === "supported" && <ol className="technical-steps"><li><a href="/signup">Create an account <ExternalLink size={13}/></a>, then create an active agent in the dashboard.</li><li>Open that agent, select <strong>{setup.label}</strong>, and choose <strong>Create connection</strong>.</li><li>Copy the private configuration generated on the agent page and place it in the location above.</li><li>{setup.verify}</li></ol>}<pre className="technical-config">{config}</pre>{setup.support === "supported" && <><button className="button button-primary" onClick={copy}>{copied ? <><Check size={16}/>Copied</> : <><Copy size={16}/>Copy complete setup prompt</>}</button><p className="form-hint">The copied prompt includes the endpoint, exact location, verification step, safe calling behavior, and owner-update checkpoint rule. Create the connection first; its private token is deliberately shown only inside your signed-in agent page.</p></>}</article></div>;
}
