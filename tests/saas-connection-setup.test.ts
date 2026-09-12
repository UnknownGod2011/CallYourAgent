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

test("ChatGPT web is explicitly unavailable and complete setup prompts keep checkpoint behavior", () => {
  assert.equal(connectionSetups["chatgpt-web"].support, "pending");
  const prompt = connectionPrompt("generic", endpoint, token);
  assert.match(prompt, /pull_human_updates/);
  assert.match(prompt, /Never ask for a CALL-E API key/);
  assert.match(prompt, new RegExp(token));
});
