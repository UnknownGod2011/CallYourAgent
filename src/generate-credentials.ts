import { randomBytes } from "node:crypto";
import { standardCredentialBundle } from "./credential-roles.js";

export function generateCredentialJson(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16) {
    throw new Error("Credential token size must be an integer of at least 16 bytes");
  }
  const credentials = standardCredentialBundle(() => randomBytes(bytes).toString("base64url"));
  return JSON.stringify(credentials);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${generateCredentialJson()}\n`);
}
