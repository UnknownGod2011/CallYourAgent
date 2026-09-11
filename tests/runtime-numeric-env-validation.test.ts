import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildRuntimeFromEnv,
  callPolicyConfigFromEnv,
  lifecycleRecoveryConfigFromEnv,
  lifecycleSweepIntervalMsFromEnv,
  startRuntimeFromEnv,
} from "../src/server.js";

function sqliteEnv(databasePath: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CYA_API_TOKEN: "test-token",
    CYA_CALL_PROVIDER: "fake",
    CYA_STORE: "sqlite",
    CYA_SQLITE_PATH: databasePath,
    ...overrides,
  };
}

test("canonical decimal numeric environment values preserve valid zero and positive semantics", () => {
  assert.deepEqual(callPolicyConfigFromEnv({
    CYA_MAX_DECISION_CALLS_PER_RUN: "0",
    CYA_MAX_DECISION_CALLS_PER_OWNER_24H: "12",
    CYA_QUIET_HOURS_START: "0",
    CYA_QUIET_HOURS_END: "23",
    CYA_QUIET_HOURS_TIME_ZONE: "UTC",
  }), {
    maxDecisionCallsPerRun: 0,
    maxDecisionCallsPerOwner24h: 12,
    quietHours: {
      startHour: 0,
      endHour: 23,
      timeZone: "UTC",
      bypassPriority: "critical",
    },
  });

  assert.deepEqual(lifecycleRecoveryConfigFromEnv({
    CYA_MAX_AUTOMATIC_RECOVERY_ATTEMPTS: "0",
    CYA_RECOVERY_BASE_BACKOFF_MS: "1",
    CYA_RECOVERY_MAX_BACKOFF_MS: "60000",
    CYA_MAX_IN_PROGRESS_CALL_AGE_MS: "600000",
  }), {
    maxAutomaticRecoveryAttempts: 0,
    baseBackoffMs: 1,
    maxBackoffMs: 60000,
    maxInProgressCallAgeMs: 600000,
  });
  assert.equal(lifecycleSweepIntervalMsFromEnv({ CYA_LIFECYCLE_SWEEP_INTERVAL_MS: "5000" }), 5000);
});

test("coercive numeric runtime settings are rejected before durable SQLite storage opens", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cya-numeric-env-"));
  try {
    const cases: Array<{ env: NodeJS.ProcessEnv; expected: RegExp }> = [
      { env: { CYA_FAKE_AUTO_COMPLETE_AFTER_OBSERVATIONS: "01" }, expected: /CYA_FAKE_AUTO_COMPLETE_AFTER_OBSERVATIONS must be a positive integer/ },
      { env: { CYA_CALLBACK_RATE_LIMIT_PER_MINUTE: "+6" }, expected: /CYA_CALLBACK_RATE_LIMIT_PER_MINUTE must be a non-negative integer/ },
      { env: { CYA_RECONCILE_RATE_LIMIT_PER_MINUTE: "1e2" }, expected: /CYA_RECONCILE_RATE_LIMIT_PER_MINUTE must be a non-negative integer/ },
      { env: { CYA_MAX_DECISION_CALLS_PER_RUN: " 2" }, expected: /CYA_MAX_DECISION_CALLS_PER_RUN must be a non-negative integer/ },
      {
        env: {
          CYA_QUIET_HOURS_START: "08",
          CYA_QUIET_HOURS_END: "20",
          CYA_QUIET_HOURS_TIME_ZONE: "UTC",
        },
        expected: /CYA_QUIET_HOURS_START must be an hour from 0 to 23/,
      },
      { env: { CYA_MAX_AUTOMATIC_RECOVERY_ATTEMPTS: "03" }, expected: /CYA_MAX_AUTOMATIC_RECOVERY_ATTEMPTS must be a non-negative integer/ },
      { env: { CYA_RECOVERY_BASE_BACKOFF_MS: "5.0" }, expected: /CYA_RECOVERY_BASE_BACKOFF_MS must be a positive integer/ },
      { env: { CYA_RECOVERY_MAX_BACKOFF_MS: "060000" }, expected: /CYA_RECOVERY_MAX_BACKOFF_MS must be a positive integer/ },
      { env: { CYA_MAX_IN_PROGRESS_CALL_AGE_MS: "+600000" }, expected: /CYA_MAX_IN_PROGRESS_CALL_AGE_MS must be a positive integer/ },
      { env: { CYA_CALLBACK_RATE_LIMIT_PER_MINUTE: "9007199254740992" }, expected: /CYA_CALLBACK_RATE_LIMIT_PER_MINUTE must be a non-negative integer/ },
    ];

    for (const [index, entry] of cases.entries()) {
      const databasePath = join(directory, `state-${index}.db`);
      assert.throws(() => buildRuntimeFromEnv(sqliteEnv(databasePath, entry.env)), entry.expected);
      await assert.rejects(access(databasePath));
    }

    const liveDatabasePath = join(directory, "live-state.db");
    assert.throws(() => buildRuntimeFromEnv(sqliteEnv(liveDatabasePath, {
      CYA_CALL_PROVIDER: "calle",
      CALLE_API_KEY: "test-calle-key",
      CYA_OWNER_PHONE: "+15555550123",
      CYA_PUBLIC_BASE_URL: "https://cya.example.com",
      CYA_CALLE_WEBHOOK_TOKEN: "test-webhook-token",
      CYA_CALLE_HTTP_TIMEOUT_MS: "015000",
    })), /CYA_CALLE_HTTP_TIMEOUT_MS must be a positive integer/);
    await assert.rejects(access(liveDatabasePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("coercive port and lifecycle interval fail before runtime construction opens SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cya-numeric-startup-"));
  try {
    for (const [name, value, expected] of [
      ["PORT", "08787", /PORT must be a valid TCP port/],
      ["CYA_LIFECYCLE_SWEEP_INTERVAL_MS", "05000", /CYA_LIFECYCLE_SWEEP_INTERVAL_MS must be a positive integer/],
    ] as const) {
      const databasePath = join(directory, `${name}.db`);
      await assert.rejects(
        startRuntimeFromEnv(sqliteEnv(databasePath, { [name]: value })),
        expected,
      );
      await assert.rejects(access(databasePath));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
