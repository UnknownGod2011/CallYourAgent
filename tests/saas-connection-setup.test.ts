import assert from "node:assert/strict";
import test from "node:test";
import { connectionPrompt, connectionSetups } from "../lib/connection-setup.js";

const endpoint = "https://callyouragent.vercel.app/mcp";
const token = "cya_test_token";

test("each supported host generates the documented remote MCP transport shape", () => {
  assert.match(connectionSetups.codex.config(endpoint, token), /codex mcp add callyouragent --url/);
  assert.equal(JSON.parse(connectionSetups["claude-code"].config(endpoint, token)).mcpServers.callyouragent.type, "http");
  assert.equal(JSON.parse(connectionSetups["gemini-cli"].config(endpoint, token)).mcpServers.callyouragent.httpUrl, endpoint);
  assert.equal(JSON.parse(connectionSetups.kiro.config(endpoint, token)).mcpServers.callyouragent.url, endpoint);
  assert.equal(JSON.parse(connectionSetups.antigravity.config(endpoint, token)).mcpServers.callyouragent.serverUrl, endpoint);
  assert.equal(JSON.parse(connectionSetups.generic.config(endpoint, token)).mcpServers.callyouragent.headers.Authorization, `Bearer ${token}`);
});

test("ChatGPT web is explicitly unavailable and setup prompts are credential-free", () => {
  assert.equal(connectionSetups["chatgpt-web"].support, "pending");
  for (const host of Object.keys(connectionSetups) as Array<keyof typeof connectionSetups>) {
    const prompt = connectionPrompt(host, endpoint);
    assert.match(prompt, /Never ask for a CALL-E API key/);
    assert.doesNotMatch(prompt, new RegExp(token));
    assert.doesNotMatch(prompt, /Authorization:\s*Bearer/i);
    assert.doesNotMatch(prompt, /Private connection configuration/i);
  }
  assert.match(connectionPrompt("generic", endpoint), /pull_human_updates/);
});
