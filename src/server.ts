import { ControlPlane } from "./control-plane.js";
import { FakeCallProvider } from "./call-provider.js";
import { CallPolicy, type CallPolicyConfig } from "./call-policy.js";
import { CalleCallProvider } from "./calle-provider.js";
import { createControlPlaneHttpServer, type ApiCredential, type ApiScope, type ReadinessSnapshot } from "./http-server.js";
import type { EscalationPriority } from "./domain.js";
import { LifecycleManager, type LifecycleRecoveryConfig } from "./lifecycle.js";
import { InMemoryControlPlaneStore } from "./store.js";
import { SqliteControlPlaneStore } from "./sqlite-store.js";

export function buildRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const providerMode = env.CYA_CALL_PROVIDER ?? "fake";
  const storeMode = env.CYA_STORE ?? "sqlite";
  const apiToken = env.CYA_API_TOKEN?.trim() || undefined;
  const apiCredentials = apiCredentialsFromEnv(env);
  if (!apiToken && apiCredentials.length === 0) {
    throw new Error("CYA_API_TOKEN or CYA_API_CREDENTIALS_JSON is required");
  }
  if (storeMode !== "memory" && storeMode !== "sqlite") {
    throw new Error(`Unsupported CYA_STORE: ${storeMode}`);
  }

  let provider: FakeCallProvider | CalleCallProvider;
  if (providerMode === "fake") {
    provider = new FakeCallProvider();
  } else if (providerMode === "calle") {
    const webhookToken = required(env.CYA_CALLE_WEBHOOK_TOKEN, "CYA_CALLE_WEBHOOK_TOKEN");
    const publicBaseUrl = required(env.CYA_PUBLIC_BASE_URL, "CYA_PUBLIC_BASE_URL").replace(/\/$/, "");
    provider = new CalleCallProvider({
      apiKey: required(env.CALLE_API_KEY, "CALLE_API_KEY"),
      ownerPhone: required(env.CYA_OWNER_PHONE, "CYA_OWNER_PHONE"),
      baseUrl: env.CALLE_BASE_URL,
      webhookUrl: `${publicBaseUrl}/webhooks/calle?token=${encodeURIComponent(webhookToken)}`,
      requestTimeoutMs: env.CYA_CALLE_HTTP_TIMEOUT_MS
        ? positiveInteger(env.CYA_CALLE_HTTP_TIMEOUT_MS, "CYA_CALLE_HTTP_TIMEOUT_MS")
        : undefined,
    });
  } else {
    throw new Error(`Unsupported CYA_CALL_PROVIDER: ${providerMode}`);
  }

  // Validate every remaining environment-derived setting before opening a durable store.
  const callPolicyConfig = callPolicyConfigFromEnv(env);
  const lifecycleConfig = lifecycleRecoveryConfigFromEnv(env);
  const rateLimits = {
    ownerCallbacksPerWindow: env.CYA_CALLBACK_RATE_LIMIT_PER_MINUTE
      ? nonNegativeInteger(env.CYA_CALLBACK_RATE_LIMIT_PER_MINUTE, "CYA_CALLBACK_RATE_LIMIT_PER_MINUTE")
      : undefined,
    reconciliationsPerWindow: env.CYA_RECONCILE_RATE_LIMIT_PER_MINUTE
      ? nonNegativeInteger(env.CYA_RECONCILE_RATE_LIMIT_PER_MINUTE, "CYA_RECONCILE_RATE_LIMIT_PER_MINUTE")
      : undefined,
  };
  const readiness = readinessSnapshot(providerMode, storeMode);

  const store = storeMode === "memory"
    ? new InMemoryControlPlaneStore()
    : SqliteControlPlaneStore.open(env.CYA_SQLITE_PATH ?? "callyouragent.db");

  try {
    const callPolicy = new CallPolicy(callPolicyConfig);
    const controlPlane = new ControlPlane(store, provider, undefined, callPolicy);
    const lifecycle = new LifecycleManager(controlPlane, store, undefined, lifecycleConfig);
    const server = createControlPlaneHttpServer(controlPlane, {
      apiToken,
      apiCredentials,
      calleWebhookToken: env.CYA_CALLE_WEBHOOK_TOKEN,
      rateLimits,
      readiness,
    });

    return { server, controlPlane, lifecycle, provider, store, readiness };
  } catch (error) {
    store.close();
    throw error;
  }
}

export type RunningRuntime = ReturnType<typeof buildRuntimeFromEnv> & {
  port: number;
  shutdown(): Promise<void>;
};

/**
 * Start the HTTP control plane and periodic lifecycle sweep as one owned runtime.
 * Shutdown is idempotent and drains both HTTP work and any in-flight sweep before
 * the backing store is closed.
 */
export async function startRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<RunningRuntime> {
  const port = tcpPort(env.PORT ?? "8787", "PORT");
  const intervalMs = lifecycleSweepIntervalMsFromEnv(env);
  const runtime = buildRuntimeFromEnv(env);

  try {
    await listen(runtime.server, port);
  } catch (error) {
    runtime.store.close();
    throw error;
  }

  let stopping = false;
  let activeSweep: Promise<void> | undefined;
  const runSweep = (): void => {
    if (stopping || activeSweep) return;
    activeSweep = runtime.lifecycle.sweep()
      .then((result) => {
        if (result.errors.length > 0) console.error("CallYourAgent lifecycle sweep errors", result.errors);
      })
      .catch((error) => console.error("CallYourAgent lifecycle sweep failed", error))
      .finally(() => { activeSweep = undefined; });
  };

  const sweepTimer = setInterval(runSweep, intervalMs);
  sweepTimer.unref();

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    clearInterval(sweepTimer);
    const httpDrain = closeServer(runtime.server);
    const sweepDrain = activeSweep ?? Promise.resolve();
    shutdownPromise = Promise.all([httpDrain, sweepDrain]).then(() => {
      runtime.store.close();
    });
    return shutdownPromise;
  };

  const address = runtime.server.address();
  const listeningPort = typeof address === "object" && address !== null ? address.port : port;
  return { ...runtime, port: listeningPort, shutdown };
}

export function readinessSnapshot(
  providerMode: "fake" | "calle",
  storeMode: "memory" | "sqlite",
): ReadinessSnapshot {
  const live = providerMode === "calle";
  return {
    ready: true,
    providerMode,
    storeMode,
    liveCallConfiguration: live ? "configured" : "not_applicable",
    publicWebhookConfiguration: live ? "configured" : "not_applicable",
    providerNetworkChecked: false,
  };
}

export function apiCredentialsFromEnv(env: NodeJS.ProcessEnv): ApiCredential[] {
  if (!env.CYA_API_CREDENTIALS_JSON?.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(env.CYA_API_CREDENTIALS_JSON); }
  catch { throw new Error("CYA_API_CREDENTIALS_JSON must be valid JSON"); }
  if (!Array.isArray(parsed)) throw new Error("CYA_API_CREDENTIALS_JSON must be a JSON array");
  const credentials = parsed.map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`CYA_API_CREDENTIALS_JSON[${index}] must be an object`);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id.trim()) throw new Error(`CYA_API_CREDENTIALS_JSON[${index}].id is required`);
    if (typeof record.token !== "string" || !record.token.trim()) throw new Error(`CYA_API_CREDENTIALS_JSON[${index}].token is required`);
    if (!Array.isArray(record.scopes) || record.scopes.length === 0 || record.scopes.some((scope) => !isApiScope(scope))) {
      throw new Error(`CYA_API_CREDENTIALS_JSON[${index}].scopes contains an invalid API scope`);
    }
    return { id: record.id, token: record.token, scopes: record.scopes as ApiScope[] };
  });
  if (new Set(credentials.map((credential) => credential.id)).size !== credentials.length) {
    throw new Error("CYA_API_CREDENTIALS_JSON credential ids must be unique");
  }
  if (new Set(credentials.map((credential) => credential.token)).size !== credentials.length) {
    throw new Error("CYA_API_CREDENTIALS_JSON credential tokens must be unique");
  }
  return credentials;
}

export function callPolicyConfigFromEnv(env: NodeJS.ProcessEnv): CallPolicyConfig {
  const config: CallPolicyConfig = {};
  if (env.CYA_MIN_DECISION_PRIORITY) config.minimumDecisionPriority = priority(env.CYA_MIN_DECISION_PRIORITY, "CYA_MIN_DECISION_PRIORITY");
  if (env.CYA_MAX_DECISION_CALLS_PER_RUN) config.maxDecisionCallsPerRun = nonNegativeInteger(env.CYA_MAX_DECISION_CALLS_PER_RUN, "CYA_MAX_DECISION_CALLS_PER_RUN");
  if (env.CYA_MAX_DECISION_CALLS_PER_OWNER_24H) config.maxDecisionCallsPerOwner24h = nonNegativeInteger(env.CYA_MAX_DECISION_CALLS_PER_OWNER_24H, "CYA_MAX_DECISION_CALLS_PER_OWNER_24H");

  const quietValues = [env.CYA_QUIET_HOURS_START, env.CYA_QUIET_HOURS_END, env.CYA_QUIET_HOURS_TIME_ZONE];
  if (quietValues.some(Boolean)) {
    if (!quietValues.every((value) => value?.trim())) {
      throw new Error("CYA_QUIET_HOURS_START, CYA_QUIET_HOURS_END, and CYA_QUIET_HOURS_TIME_ZONE must be configured together");
    }
    config.quietHours = {
      startHour: hour(env.CYA_QUIET_HOURS_START!, "CYA_QUIET_HOURS_START"),
      endHour: hour(env.CYA_QUIET_HOURS_END!, "CYA_QUIET_HOURS_END"),
      timeZone: env.CYA_QUIET_HOURS_TIME_ZONE!,
      bypassPriority: env.CYA_QUIET_HOURS_BYPASS_PRIORITY
        ? priority(env.CYA_QUIET_HOURS_BYPASS_PRIORITY, "CYA_QUIET_HOURS_BYPASS_PRIORITY")
        : "critical",
    };
  } else if (env.CYA_QUIET_HOURS_BYPASS_PRIORITY) {
    throw new Error("CYA_QUIET_HOURS_BYPASS_PRIORITY requires quiet hours to be configured");
  }

  return config;
}

export function lifecycleRecoveryConfigFromEnv(env: NodeJS.ProcessEnv): LifecycleRecoveryConfig {
  const config: LifecycleRecoveryConfig = {};
  if (env.CYA_MAX_AUTOMATIC_RECOVERY_ATTEMPTS) {
    config.maxAutomaticRecoveryAttempts = nonNegativeInteger(env.CYA_MAX_AUTOMATIC_RECOVERY_ATTEMPTS, "CYA_MAX_AUTOMATIC_RECOVERY_ATTEMPTS");
  }
  if (env.CYA_RECOVERY_BASE_BACKOFF_MS) {
    config.baseBackoffMs = positiveInteger(env.CYA_RECOVERY_BASE_BACKOFF_MS, "CYA_RECOVERY_BASE_BACKOFF_MS");
  }
  if (env.CYA_RECOVERY_MAX_BACKOFF_MS) {
    config.maxBackoffMs = positiveInteger(env.CYA_RECOVERY_MAX_BACKOFF_MS, "CYA_RECOVERY_MAX_BACKOFF_MS");
  }
  if (env.CYA_MAX_IN_PROGRESS_CALL_AGE_MS) {
    config.maxInProgressCallAgeMs = positiveInteger(env.CYA_MAX_IN_PROGRESS_CALL_AGE_MS, "CYA_MAX_IN_PROGRESS_CALL_AGE_MS");
  }
  return config;
}

export function lifecycleSweepIntervalMsFromEnv(env: NodeJS.ProcessEnv): number {
  return env.CYA_LIFECYCLE_SWEEP_INTERVAL_MS
    ? positiveInteger(env.CYA_LIFECYCLE_SWEEP_INTERVAL_MS, "CYA_LIFECYCLE_SWEEP_INTERVAL_MS")
    : 5_000;
}

function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && ["agent:read", "agent:write", "decision:read", "audit:read", "owner:callback", "calls:reconcile", "*"].includes(value);
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}

function nonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function tcpPort(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) throw new Error(`${name} must be a valid TCP port`);
  return parsed;
}

function hour(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) throw new Error(`${name} must be an hour from 0 to 23`);
  return parsed;
}

function priority(value: string, name: string): EscalationPriority {
  if (["low", "normal", "high", "critical"].includes(value)) return value as EscalationPriority;
  throw new Error(`${name} must be one of low, normal, high, critical`);
}

function listen(server: ReturnType<typeof createControlPlaneHttpServer>, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

function closeServer(server: ReturnType<typeof createControlPlaneHttpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startRuntimeFromEnv().then((runtime) => {
    console.log(`CallYourAgent listening on :${runtime.port}`);
    let signalReceived = false;
    const handleSignal = (signal: NodeJS.Signals): void => {
      if (signalReceived) return;
      signalReceived = true;
      console.error(`CallYourAgent received ${signal}; shutting down gracefully`);
      void runtime.shutdown()
        .then(() => { process.exitCode = 0; })
        .catch((error) => {
          console.error("CallYourAgent graceful shutdown failed", error);
          process.exitCode = 1;
        });
    };
    process.once("SIGTERM", handleSignal);
    process.once("SIGINT", handleSignal);
  }).catch((error) => {
    console.error("CallYourAgent startup failed", error);
    process.exitCode = 1;
  });
}
