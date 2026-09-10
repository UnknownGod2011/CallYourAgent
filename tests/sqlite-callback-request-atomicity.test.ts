import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider, type StartCallInput, type StartCallResult } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import type { AuditEvent } from "../src/domain.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

class CountingFakeCallProvider extends FakeCallProvider {
  startCalls = 0;

  override async start(input: StartCallInput): Promise<StartCallResult> {
    this.startCalls += 1;
    return super.start(input);
  }
}

async function withSqliteStore<T>(run: (store: SqliteControlPlaneStore) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-callback-request-atomicity-"));
  const store = SqliteControlPlaneStore.open(join(directory, "state.db"));
  try {
    return await run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function failOwnerCallbackRequestedAuditOnce(store: SqliteControlPlaneStore): () => void {
  const originalSet = store.auditEvents.set.bind(store.auditEvents);
  let failed = false;
  store.auditEvents.set = ((key: string, value: AuditEvent) => {
    if (!failed && value.type === "owner_callback_requested") {
      failed = true;
      throw new Error("injected owner callback request audit failure");
    }
    originalSet(key, value);
    return store.auditEvents;
  }) as typeof store.auditEvents.set;
  return () => {
    store.auditEvents.set = originalSet as typeof store.auditEvents.set;
  };
}

test("SQLite rolls back owner callback reservation when owner_callback_requested audit fails before provider I/O", async () => {
  await withSqliteStore(async (store) => {
    const provider = new CountingFakeCallProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "callback-request-atomicity", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working", "documentation");

    const restoreAudit = failOwnerCallbackRequestedAuditOnce(store);
    await assert.rejects(
      control.requestOwnerCallback({
        runId: run.id,
        prompt: "Give me a progress update",
        idempotencyKey: "callback-request-audit-failure",
      }),
      /injected owner callback request audit failure/,
    );
    restoreAudit();

    assert.equal(provider.startCalls, 0);
    assert.equal(store.callAttempts.size, 0);
    assert.equal(store.callbackByIdempotencyKey.size, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_created").length, 0);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_callback_requested").length, 0);

    const callback = await control.requestOwnerCallback({
      runId: run.id,
      prompt: "Give me a progress update",
      idempotencyKey: "callback-request-audit-failure",
    });

    assert.equal(provider.startCalls, 1);
    assert.ok(callback.providerCallId);
    assert.equal(store.callAttempts.size, 1);
    assert.equal(store.callbackByIdempotencyKey.get("callback-request-audit-failure"), callback.id);

    const callbackEvents = control.listAuditEvents(run.id).filter((event) => event.callAttemptId === callback.id);
    assert.deepEqual(
      callbackEvents.map((event) => event.type),
      ["call_attempt_created", "owner_callback_requested", "call_attempt_started"],
    );

    const retry = await control.requestOwnerCallback({
      runId: run.id,
      prompt: "Give me a progress update",
      idempotencyKey: "callback-request-audit-failure",
    });
    assert.equal(retry.id, callback.id);
    assert.equal(provider.startCalls, 1);
    assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_callback_requested").length, 1);
  });
});
