// =============================================================================
// HVA-90: Discord webhook URL validator
// =============================================================================
//
// Sandeep 2026-06-05: *"Validate the Discord webhook URL on save by
// actually pinging Discord (real webhook test, not just regex)."*
//
// Two-stage check:
//   1. Shape: must look like a Discord webhook URL.
//   2. Live ping: POST a small test message and verify Discord 2xx.
//
// The test message uses a `username` of "Beakn config check" + a short
// body so admins watching the channel can see the validation hit was
// from this code path. We deliberately do NOT silently swallow Discord
// errors — the admin needs to see "channel deleted / token revoked /
// rate-limited" inline on the form so they know exactly why save
// failed.
//
// 5-second AbortController timeout. The Discord webhook endpoint
// typically responds in < 200ms; 5s is generous enough to absorb a
// transient network hiccup without making the save UI feel hung.
// =============================================================================

const DISCORD_WEBHOOK_RE =
  /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/;

export interface WebhookValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate a Discord webhook URL by shape + live ping.
 *
 * Returns `{ ok: true }` if Discord accepts the test message.
 * Returns `{ ok: false, error }` with a user-readable reason on
 * any failure path (bad URL, 4xx, 5xx, network timeout, etc.).
 *
 * Never throws — the caller decides whether to surface the error
 * inline or short-circuit the save.
 */
export async function validateDiscordWebhook(
  url: string,
): Promise<WebhookValidationResult> {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Webhook URL is empty.' };
  }
  if (!DISCORD_WEBHOOK_RE.test(trimmed)) {
    return {
      ok: false,
      error:
        'URL does not look like a Discord webhook. Expected https://discord.com/api/webhooks/<id>/<token>.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(trimmed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Beakn config check',
        content:
          '✅ Webhook validated by Beakn admin — this channel will now receive new customer requests.',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      return { ok: true };
    }

    // Read Discord's error response so we can surface its `message`
    // verbatim (e.g. "Unknown Webhook", "Invalid Webhook Token").
    let discordMessage = '';
    try {
      const body = (await response.json()) as { message?: string };
      if (typeof body.message === 'string') discordMessage = body.message;
    } catch {
      // Body wasn't JSON — fall through to the generic status-based message.
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: discordMessage || 'Discord rejected the webhook token.',
      };
    }
    if (response.status === 404) {
      return {
        ok: false,
        error:
          discordMessage ||
          'Discord could not find this webhook. Channel deleted or webhook revoked?',
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        error: 'Discord rate-limited the validation ping. Try again in a few seconds.',
      };
    }
    return {
      ok: false,
      error: discordMessage || `Discord returned ${response.status}.`,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ok: false,
        error: 'Discord did not respond within 5 seconds. Try again.',
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error reaching Discord.',
    };
  }
}
