import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryControlPlaneStore, type ControlPlaneStore } from "../src/store.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function verifyRollbackContract(store: ControlPlaneStore): void {
  store.callbackByIdempotencyKey.set("baseline", "callback-baseline");
  store.processedWebhookEventIds.add("event-baseline");

  assert.throws(() => store.transaction(() => {
    store.callbackByIdempotencyKey.set("outer", "callback-outer");
    store.processedWebhookEventIds.add("event-outer");

    store.transaction(() => {
      store.callbackByIdempotencyKey.set("nested", "callback-nested");
      store.processedWebhookEventIds.add("event-nested");
    });

    throw new Error("force rollback");
  }), /force rollback/);

  assert.equal(store.callbackByIdempotencyKey.get("baseline"), "callback-baseline");
  assert.equal(store.processedWebhookEventIds.has("event-baseline"), true);
  assert.equal(store.callbackByIdempotencyKey.has("outer"), false);
  assert.equal(store.callbackByIdempotencyKey.has("nested"), false);
  assert.equal(store.processedWebhookEventIds.has("event-outer"), false);
  assert.equal(store.processedWebhookEventIds.has("event-nested"), false);

  store.transaction(() => {
    store.callbackByIdempotencyKey.set("committed", "callback-committed");
    store.processedWebhookEventIds.add("event-committed");
  });

  assert.equal(store.callbackByIdempotencyKey.get("committed"), "callback-committed");
  assert.equal(store.processedWebhookEventIds.has("event-committed"), true);
}

test("in-memory store transaction contract rolls back outer and nested mutations", () => {
  const store = new InMemoryControlPlaneStore();
  verifyRollbackContract(store);
});

test("SQLite store matches the transaction rollback contract and persists only committed state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cya-store-contract-"));
  const databasePath = join(directory, "state.db");
  try {
    const store = SqliteControlPlaneStore.open(databasePath);
    verifyRollbackContract(store);
    store.close();

    const reopened = SqliteControlPlaneStore.open(databasePath);
    try {
      assert.equal(reopened.callbackByIdempotencyKey.get("baseline"), "callback-baseline");
      assert.equal(reopened.processedWebhookEventIds.has("event-baseline"), true);
      assert.equal(reopened.callbackByIdempotencyKey.has("outer"), false);
      assert.equal(reopened.callbackByIdempotencyKey.has("nested"), false);
      assert.equal(reopened.processedWebhookEventIds.has("event-outer"), false);
      assert.equal(reopened.processedWebhookEventIds.has("event-nested"), false);
      assert.equal(reopened.callbackByIdempotencyKey.get("committed"), "callback-committed");
      assert.equal(reopened.processedWebhookEventIds.has("event-committed"), true);
    } finally {
      reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
