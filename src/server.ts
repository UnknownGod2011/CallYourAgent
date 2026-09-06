import { ControlPlane } from "./control-plane.js";
import { FakeCallProvider } from "./call-provider.js";
import { CalleCallProvider } from "./calle-provider.js";
import { createControlPlaneHttpServer } from "./http-server.js";
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

  const controlPlane = new ControlPlane(store, provider);
  const server = createControlPlaneHttpServer(controlPlane, {
    apiToken,
    calleWebhookToken: env.CYA_CALLE_WEBHOOK_TOKEN,
  });

  return { server, controlPlane, provider, store };
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
  const { server } = buildRuntimeFromEnv();
  server.listen(port, () => console.log(`CallYourAgent listening on :${port}`));
}
