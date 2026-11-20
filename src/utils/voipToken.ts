/** PushKit tokens arrive with spaces or angle brackets from some iOS bridges. */
export function normalizeVoipToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/\s+/g, '');
}

/**
 * Read a PushKit token from a device-register body.
 * Empty / missing means "keep the token already stored" (same as OneVibe).
 */
export function readVoipToken(body: Record<string, unknown> | null | undefined): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw =
    body.voipToken ??
    body.voip_token ??
    body.pushKitToken ??
    body.push_kit_token ??
    body.apnsVoipToken ??
    body.apns_voip_token ??
    body.voipPushToken;
  if (raw == null) return undefined;
  const token = normalizeVoipToken(raw);
  return token || undefined;
}
