import assert from "node:assert/strict";
import test from "node:test";
import { connectionKitHtml } from "../src/connect-ui.js";

test("connection kit generates browser-local deployment and MCP guidance without embedded secrets", () => {
  const page = connectionKitHtml();
  assert.match(page, /Connect your phone to your agent/);
  assert.match(page, /CYA_OWNER_PHONE/);
  assert.match(page, /CYA_CALL_PROVIDER=calle/);
  assert.match(page, /callyouragent/);
  assert.match(page, /ChatGPT desktop app/);
  assert.match(page, /Hosted ChatGPT \/ ChatGPT Work/);
  assert.match(page, /Gemini CLI/);
  assert.match(page, /Kiro/);
  assert.match(page, /codex mcp add callyouragent/);
  assert.match(page, /\.gemini\/settings\.json/);
  assert.match(page, /\.kiro\/settings\/mcp\.json/);
  assert.match(page, /remote Streamable HTTP MCP endpoint/);
  assert.match(page, /verified, branded caller ID/);
  assert.match(page, /request_owner_decision/);
  assert.match(page, /acknowledge exactly the instruction ids/);
  assert.match(page, /does not submit or store your phone number or tokens/i);
  assert.doesNotMatch(page, /CALLE_API_KEY=iams_live/);
});
