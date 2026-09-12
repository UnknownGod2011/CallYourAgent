"use client";
import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

const hosts = ["Codex CLI / IDE", "ChatGPT desktop", "Claude Code", "Gemini CLI", "Kiro"] as const;
type Host = typeof hosts[number];
const steps: Record<Host, string> = {
  "Codex CLI / IDE": "Open CallYourAgent, sign in, create an agent, and open that agent’s Connect external agent section. Create a Codex connection, copy the generated remote MCP configuration, add it through Codex MCP settings, then restart Codex.",
  "ChatGPT desktop": "Open CallYourAgent, sign in, create an agent, and create a ChatGPT desktop connection. Copy the generated remote MCP configuration into ChatGPT desktop’s MCP server settings, then restart the desktop app.",
  "Claude Code": "Open CallYourAgent, sign in, create an agent, and create a Claude Code connection. Copy the generated remote MCP configuration into Claude Code’s MCP settings, then reopen Claude Code.",
  "Gemini CLI": "Open CallYourAgent, sign in, create an agent, and create a Gemini CLI connection. Copy the generated remote MCP configuration into your Gemini MCP settings, then restart Gemini CLI.",
  Kiro: "Open CallYourAgent, sign in, create an agent, and create a Kiro connection. Copy the generated remote MCP configuration into Kiro’s MCP settings, then restart Kiro.",
};
const config = `{
  "mcpServers": {
    "callyouragent": {
      "url": "https://callyouragent.vercel.app/mcp",
      "headers": {
        "Authorization": "Bearer <PASTE_YOUR_AGENT_CONNECTION_TOKEN>"
      }
    }
  }
}`;
export function ConnectionKit(){const[host,setHost]=useState<Host>("Kiro");const[copied,setCopied]=useState(false);const prompt=`Help me complete a CallYourAgent remote MCP setup for ${host}. First open https://callyouragent.vercel.app/signup (or https://callyouragent.vercel.app/login), create an active agent, open that agent, select ${host}, and choose Create connection. I will copy the private configuration generated there. For Kiro, open the workspace MCP configuration using Ctrl+Shift+P → “Kiro: Open workspace MCP config (JSON)” and add the configuration exactly as provided, keeping the Authorization header. Save it, then use Kiro’s MCP panel to confirm CallYourAgent is connected. The MCP endpoint is https://callyouragent.vercel.app/mcp. Once connected, use request_phone_call only for a user-authorized human decision, confirmation, or alert. The phone number must be supplied in E.164 format (for example +919920090093). Use get_call_status after a call and pull_human_updates at safe checkpoints. Never ask for or expose a CALL-E API key; CallYourAgent owns the call transport. Never claim that an update interrupted an in-progress response.`;async function copy(){await navigator.clipboard.writeText(prompt);setCopied(true);setTimeout(()=>setCopied(false),1800)}return <div className="kit"><aside>{hosts.map(item=><button key={item} className={host===item?"kit-host active":"kit-host"} onClick={()=>setHost(item)}>{item}</button>)}</aside><article><p className="eyebrow">{host}</p><h2>Technical setup</h2><ol className="technical-steps"><li><a href="/signup">Create an account <ExternalLink size={13}/></a>, then create an active agent in the dashboard.</li><li>Open the agent, select <strong>{host}</strong>, and choose <strong>Create connection</strong>. Copy the private configuration it reveals.</li><li>In Kiro: press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>, choose <strong>Kiro: Open workspace MCP config (JSON)</strong>, then paste the configuration.</li><li>Save the file. Open Kiro’s MCP panel and verify <strong>CallYourAgent</strong> shows as connected.</li></ol><p className="form-hint">The generated token replaces the placeholder below. It is private, shown once, and revocable from the agent page.</p><pre className="technical-config">{config}</pre><button className="button button-primary" onClick={copy}>{copied?<><Check size={16}/>Copied</>:<><Copy size={16}/>Copy setup prompt for AI</>}</button><p className="form-hint">The copied prompt includes the links, Kiro command-palette route, endpoint, tool behavior, and phone-number format. It does not contain your private connection token.</p></article></div>}
