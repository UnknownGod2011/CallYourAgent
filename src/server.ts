import { ControlPlane } from "./control-plane.js";
import { FakeCallProvider } from "./call-provider.js";
import { CallPolicy, type CallPolicyConfig } from "./call-policy.js";
import { CalleCallProvider } from "./calle-provider.js";
import { createControlPlaneHttpServer } from "./http-server.js";
import type { EscalationPriority } from "./domain.js";
import { InMemoryControlPlaneStore } from "./store.js";
import { SqliteControlPlaneStore } from "./sqlite-store.js";

export function buildRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const providerMode = env.CYA_CALL_PROVIDER ?? "fake";
  const storeMode = env.CYA_STORE ?? "sqlite";
  const apiToken = required(env.CYA_API_TOKEN, "CYA_API_TOKEN");

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
  const server = createControlPlaneHttpServer(controlPlane, {
    apiToken,
    calleWebhookToken: env.CYA_CALLE_WEBHOOK_TOKEN,
  });

  return { server, controlPlane, provider, store };
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

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}

function nonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
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
  const { server } = buildRuntimeFromEnv();
  server.listen(port, () => console.log(`CallYourAgent listening on :${port}`));
}
