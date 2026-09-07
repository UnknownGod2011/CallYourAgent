import { ControlPlane } from "./control-plane.js";
import { FakeCallProvider } from "./call-provider.js";
import { CallPolicy, type CallPolicyConfig } from "./call-policy.js";
import { CalleCallProvider } from "./calle-provider.js";
import { createControlPlaneHttpServer, type ApiCredential, type ApiScope } from "./http-server.js";
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

  const store = storeMode === "memory"
    ? new InMemoryControlPlaneStore()
    : SqliteControlPlaneStore.open(env.CYA_SQLITE_PATH ?? "callyouragent.db");

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
    });
  } else {
    throw new Error(`Unsupported CYA_CALL_PROVIDER: ${providerMode}`);
  }

  const callPolicy = new CallPolicy(callPolicyConfigFromEnv(env));
  const controlPlane = new ControlPlane(store, provider, undefined, callPolicy);
  const lifecycle = new LifecycleManager(controlPlane, store, undefined, lifecycleRecoveryConfigFromEnv(env));
  const server = createControlPlaneHttpServer(controlPlane, {
    apiToken,
    apiCredentials,
    calleWebhookToken: env.CYA_CALLE_WEBHOOK_TOKEN,
    rateLimits: {
      ownerCallbacksPerWindow: env.CYA_CALLBACK_RATE_LIMIT_PER_MINUTE
        ? nonNegativeInteger(env.CYA_CALLBACK_RATE_LIMIT_PER_MINUTE, "CYA_CALLBACK_RATE_LIMIT_PER_MINUTE")
        : undefined,
      reconciliationsPerWindow: env.CYA_RECONCILE_RATE_LIMIT_PER_MINUTE
        ? nonNegativeInteger(env.CYA_RECONCILE_RATE_LIMIT_PER_MINUTE, "CYA_RECONCILE_RATE_LIMIT_PER_MINUTE")
        : undefined,
    },
  });

  return { server, controlPlane, lifecycle, provider, store };
}

export function apiCredentialsFromEnv(env: NodeJS.ProcessEnv): ApiCredential[] {
  if (!env.CYA_API_CREDENTIALS_JSON?.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(env.CYA_API_CREDENTIALS_JSON); }
  catch { throw new Error("CYA_API_CREDENTIALS_JSON must be valid JSON"); }
  if (!Array.isArray(parsed)) throw new Error("CYA_API_CREDENTIALS_JSON must be a JSON array");
  return parsed.map((value, index) => {
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
  return typeof value === "string" && ["agent:read", "agent:write", "audit:read", "owner:callback", "calls:reconcile", "*"].includes(value);
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

function hour(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) throw new Error(`${name} must be an hour from 0 to 23`);
  return parsed;
}

function priority(value: string, name: string): EscalationPriority {
  if (["low", "normal", "high", "critical"].includes(value)) return value as EscalationPriority;
  throw new Error(`${name} must be one of low, normal, high, critical`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
  const { server, lifecycle } = buildRuntimeFromEnv();
  const intervalMs = lifecycleSweepIntervalMsFromEnv(process.env);
  const sweepTimer = setInterval(() => {
    void lifecycle.sweep().then((result) => {
      if (result.errors.length > 0) console.error("CallYourAgent lifecycle sweep errors", result.errors);
    }).catch((error) => console.error("CallYourAgent lifecycle sweep failed", error));
  }, intervalMs);
  sweepTimer.unref();
  server.listen(port, () => console.log(`CallYourAgent listening on :${port}`));
}
