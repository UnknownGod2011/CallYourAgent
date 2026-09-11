import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

test("in-memory audit sequence allocation rolls back with the transaction", () => {
  const store = new InMemoryControlPlaneStore();
  const control = new ControlPlane(store, new FakeCallProvider());

  assert.throws(() => store.transaction(() => {
    control.registerAgent({ name: "rolled-back", platform: "test", ownerId: "owner-1" });
    throw new Error("rollback");
  }), /rollback/);

  assert.equal(store.auditEvents.size, 0);
  control.registerAgent({ name: "committed", platform: "test", ownerId: "owner-1" });
  assert.deepEqual([...store.auditEvents.values()].map((event) => event.sequence), [1]);
});

test("independent SQLite writers allocate one durable monotonic audit sequence", () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-audit-sequence-"));
  const filename = join(directory, "state.db");
  try {
    const firstStore = SqliteControlPlaneStore.open(filename);
    const secondStore = SqliteControlPlaneStore.open(filename);
    const first = new ControlPlane(firstStore, new FakeCallProvider());
    const second = new ControlPlane(secondStore, new FakeCallProvider());

    first.registerAgent({ name: "first", platform: "test", ownerId: "owner-1" });
    second.registerAgent({ name: "second", platform: "test", ownerId: "owner-1" });
    first.registerAgent({ name: "third", platform: "test", ownerId: "owner-1" });

    assert.deepEqual([...firstStore.auditEvents.values()].map((event) => event.sequence), [1, 3]);
    assert.deepEqual([...secondStore.auditEvents.values()].map((event) => event.sequence), [2]);

    assert.throws(() => firstStore.transaction(() => {
      first.registerAgent({ name: "rolled-back", platform: "test", ownerId: "owner-1" });
      throw new Error("rollback");
    }), /rollback/);

    second.registerAgent({ name: "after-rollback", platform: "test", ownerId: "owner-1" });

    firstStore.close();
    secondStore.close();

    const reopenedStore = SqliteControlPlaneStore.open(filename);
    const sequences = [...reopenedStore.auditEvents.values()]
      .map((event) => event.sequence)
      .sort((left, right) => left - right);
    assert.deepEqual(sequences, [1, 2, 3, 4]);
    assert.equal(new Set(sequences).size, sequences.length);
    reopenedStore.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
