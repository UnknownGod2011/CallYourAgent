export function requiredText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  if (trimmed.length > maxLength) throw new Error(`${label} is too long.`);
  return trimmed;
}
export function optionalText(value: unknown, maxLength: number) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Invalid text value.");
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error("Text value is too long.");
  return trimmed || null;
}
export function phoneNumber(value: unknown) {
  if (typeof value !== "string") throw new Error("Enter a phone number.");
  const normalized = value.trim().replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new Error("Use an international phone number, for example +919920090093.");
  return normalized;
}
export function apiError(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
