import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("CallYourAgent plugin supplies safe checkpoint guidance without bundling credentials", async () => {
  const root = resolve(process.cwd(), "plugins", "callyouragent");
  const manifest = JSON.parse(await readFile(resolve(root, ".codex-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
  const skill = await readFile(resolve(root, "skills", "callyouragent", "SKILL.md"), "utf8");

  assert.equal(manifest.name, "callyouragent");
  assert.equal(manifest.skills, "./skills/");
  assert.match(skill, /request_owner_decision/);
  assert.match(skill, /acknowledge_owner_instructions/);
  assert.match(skill, /do not claim an owner instruction interrupts/i);
  assert.doesNotMatch(skill, /CALLE_API_KEY=/);
});
