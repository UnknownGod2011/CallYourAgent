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

function verifyAtomicClaimContract(store: ControlPlaneStore): void {
  assert.equal(store.bindEscalationIdempotencyKey("decision-claim", "escalation-first"), "escalation-first");
  assert.equal(store.bindEscalationIdempotencyKey("decision-claim", "escalation-second"), "escalation-first");
  assert.equal(store.escalationByIdempotencyKey.get("decision-claim"), "escalation-first");

  assert.equal(store.bindCallbackIdempotencyKey("callback-claim", "callback-first"), "callback-first");
  assert.equal(store.bindCallbackIdempotencyKey("callback-claim", "callback-second"), "callback-first");
  assert.equal(store.callbackByIdempotencyKey.get("callback-claim"), "callback-first");

  assert.equal(store.bindDecisionToEscalation("escalation-terminal", "owner-decision-first"), "owner-decision-first");
  assert.equal(store.bindDecisionToEscalation("escalation-terminal", "owner-decision-second"), "owner-decision-first");
  assert.equal(store.decisionByEscalationId.get("escalation-terminal"), "owner-decision-first");

  const firstTerminal = { status: "completed" as const, fingerprint: "fingerprint-completed" };
  const conflictingTerminal = { status: "failed" as const, fingerprint: "fingerprint-failed" };
  assert.deepEqual(store.claimCallTerminalOutcome("call-terminal", firstTerminal), {
    winner: firstTerminal,
    claimed: true,
  });
  assert.deepEqual(store.claimCallTerminalOutcome("call-terminal", conflictingTerminal), {
    winner: firstTerminal,
    claimed: false,
  });
  assert.deepEqual(store.terminalOutcomeClaims.get("call-terminal"), firstTerminal);

  assert.equal(store.claimCallbackInstructionSet("callback-terminal"), true);
  assert.equal(store.claimCallbackInstructionSet("callback-terminal"), false);
  assert.equal(store.callbackInstructionSetClaims.has("callback-terminal"), true);

  assert.equal(store.claimWebhookEventId("webhook-claim"), true);
  assert.equal(store.claimWebhookEventId("webhook-claim"), false);

  assert.throws(() => store.transaction(() => {
    assert.equal(store.bindCallbackIdempotencyKey("rollback-claim", "callback-rolled-back"), "callback-rolled-back");
    assert.equal(store.bindDecisionToEscalation("rollback-escalation", "decision-rolled-back"), "decision-rolled-back");
    assert.equal(store.claimCallTerminalOutcome("call-terminal-rolled-back", conflictingTerminal).claimed, true);
    assert.equal(store.claimCallbackInstructionSet("callback-terminal-rolled-back"), true);
    assert.equal(store.claimWebhookEventId("webhook-rolled-back"), true);
    throw new Error("rollback atomic claims");
  }), /rollback atomic claims/);

  assert.equal(store.bindCallbackIdempotencyKey("rollback-claim", "callback-after-rollback"), "callback-after-rollback");
  assert.equal(store.bindDecisionToEscalation("rollback-escalation", "decision-after-rollback"), "decision-after-rollback");
  assert.deepEqual(store.claimCallTerminalOutcome("call-terminal-rolled-back", firstTerminal), {
    winner: firstTerminal,
    claimed: true,
  });
  assert.equal(store.claimCallbackInstructionSet("callback-terminal-rolled-back"), true);
  assert.equal(store.claimWebhookEventId("webhook-rolled-back"), true);
}

test("in-memory store transaction contract rolls back outer and nested mutations", () => {
  const store = new InMemoryControlPlaneStore();
  verifyRollbackContract(store);
});

test("in-memory store atomic claims are first-writer-wins and rollback-safe", () => {
  const store = new InMemoryControlPlaneStore();
  verifyAtomicClaimContract(store);
});

test("SQLite store matches the transaction rollback and atomic-claim contracts across reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cya-store-contract-"));
  const databasePath = join(directory, "state.db");
  try {
    const store = SqliteControlPlaneStore.open(databasePath);
    verifyRollbackContract(store);
    verifyAtomicClaimContract(store);
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
      assert.equal(reopened.escalationByIdempotencyKey.get("decision-claim"), "escalation-first");
      assert.equal(reopened.callbackByIdempotencyKey.get("callback-claim"), "callback-first");
      assert.equal(reopened.decisionByEscalationId.get("escalation-terminal"), "owner-decision-first");
      assert.deepEqual(reopened.terminalOutcomeClaims.get("call-terminal"), {
        status: "completed",
        fingerprint: "fingerprint-completed",
      });
      assert.equal(reopened.callbackInstructionSetClaims.has("callback-terminal"), true);
      assert.equal(reopened.processedWebhookEventIds.has("webhook-claim"), true);
      assert.equal(reopened.callbackByIdempotencyKey.get("rollback-claim"), "callback-after-rollback");
      assert.equal(reopened.decisionByEscalationId.get("rollback-escalation"), "decision-after-rollback");
      assert.deepEqual(reopened.terminalOutcomeClaims.get("call-terminal-rolled-back"), {
        status: "completed",
        fingerprint: "fingerprint-completed",
      });
      assert.equal(reopened.callbackInstructionSetClaims.has("callback-terminal-rolled-back"), true);
      assert.equal(reopened.processedWebhookEventIds.has("webhook-rolled-back"), true);
    } finally {
      reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite atomic claims return the committed winner across independent store connections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cya-store-claims-"));
  const databasePath = join(directory, "state.db");
  const first = SqliteControlPlaneStore.open(databasePath);
  const second = SqliteControlPlaneStore.open(databasePath);
  try {
    assert.equal(first.bindEscalationIdempotencyKey("shared-decision", "escalation-a"), "escalation-a");
    assert.equal(second.bindEscalationIdempotencyKey("shared-decision", "escalation-b"), "escalation-a");
    assert.equal(second.escalationByIdempotencyKey.get("shared-decision"), "escalation-a");

    assert.equal(first.bindCallbackIdempotencyKey("shared-callback", "callback-a"), "callback-a");
    assert.equal(second.bindCallbackIdempotencyKey("shared-callback", "callback-b"), "callback-a");
    assert.equal(second.callbackByIdempotencyKey.get("shared-callback"), "callback-a");

    assert.equal(first.bindDecisionToEscalation("shared-escalation", "decision-a"), "decision-a");
    assert.equal(second.bindDecisionToEscalation("shared-escalation", "decision-b"), "decision-a");
    assert.equal(second.decisionByEscalationId.get("shared-escalation"), "decision-a");

    const terminalWinner = { status: "completed" as const, fingerprint: "shared-completed" };
    assert.deepEqual(first.claimCallTerminalOutcome("shared-call-terminal", terminalWinner), {
      winner: terminalWinner,
      claimed: true,
    });
    assert.deepEqual(second.claimCallTerminalOutcome("shared-call-terminal", {
      status: "failed",
      fingerprint: "shared-failed",
    }), {
      winner: terminalWinner,
      claimed: false,
    });
    assert.deepEqual(second.terminalOutcomeClaims.get("shared-call-terminal"), terminalWinner);

    assert.equal(first.claimCallbackInstructionSet("shared-callback-terminal"), true);
    assert.equal(second.claimCallbackInstructionSet("shared-callback-terminal"), false);
    assert.equal(second.callbackInstructionSetClaims.has("shared-callback-terminal"), true);

    assert.equal(first.claimWebhookEventId("shared-webhook"), true);
    assert.equal(second.claimWebhookEventId("shared-webhook"), false);
    assert.equal(second.processedWebhookEventIds.has("shared-webhook"), true);
  } finally {
    second.close();
    first.close();
    await rm(directory, { recursive: true, force: true });
  }
});