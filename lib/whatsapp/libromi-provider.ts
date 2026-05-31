import { log } from '@/lib/logger';

import type {
  WhatsAppProvider,
  WhatsAppSendInput,
  WhatsAppSendResult,
} from './types';

// HVA-45: Libromi Connect provider (https://wa-api.cloud/api/v1).
//
// Outbound only. Webhooks (delivery + read receipts + inbound replies)
// are configured via the Libromi dashboard and land at a separate
// endpoint we will add when the webhook docs land.
//
// Error semantics (from docs):
//   - 429 RATE_LIMIT_EXCEEDED — retryable; response includes
//     `retry_after_seconds`. We retry up to MAX_RETRIES times.
//   - 5xx (DATABASE_ERROR / INTERNAL_ERROR / SERVICE_UNAVAILABLE) —
//     retryable; exponential backoff (1s, 2s, 4s).
//   - 401 UNAUTHENTICATED — permanent; surface as failed.
//   - 422 VALIDATION_ERROR — permanent.
//   - 400 INVALID_ARGUMENT — permanent (template not found, bad channel,
//     contact missing identifier).
// All other failures fail-closed (status='failed', adapter records it).

const providerLog = log.child({ component: 'whatsapp.libromi' });

const LIBROMI_BASE_URL = 'https://wa-api.cloud/api/v1';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

interface LibromiSendBody {
  to: string;
  type: 'template';
  template: WhatsAppSendInput['template'];
  from?: string;
  channel_id?: number;
  source?: string;
}

interface LibromiSuccessResponse {
  status: 'SUCCESS';
  messageId: number;
  status_url?: string;
}

interface LibromiErrorResponse {
  status: 'FAILED';
  message: string;
  error_code: string;
  retry_after_seconds?: number;
  errors?: Record<string, unknown>;
  hint?: string;
}

type LibromiResponse = LibromiSuccessResponse | LibromiErrorResponse;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read sender + channel + auth from env. Throws at call site only if the
 *  caller actually invokes send() with the libromi provider selected. */
function readLibromiConfig(): {
  token: string;
  from: string | undefined;
  channelId: number | undefined;
} {
  const token = process.env.LIBROMI_API_TOKEN;
  if (!token || token.length === 0) {
    throw new Error(
      'LIBROMI_API_TOKEN is not set. Add it to .env.local on the VPS.',
    );
  }
  const from = process.env.LIBROMI_FROM_PHONE?.trim() || undefined;
  const channelIdRaw = process.env.LIBROMI_CHANNEL_ID;
  let channelId: number | undefined;
  if (channelIdRaw && channelIdRaw.trim().length > 0) {
    const parsed = Number.parseInt(channelIdRaw, 10);
    if (Number.isFinite(parsed)) channelId = parsed;
  }
  return { token, from, channelId };
}

async function postOnce(
  token: string,
  body: LibromiSendBody,
): Promise<{
  ok: boolean;
  status: number;
  payload: LibromiResponse | null;
}> {
  let res: Response;
  try {
    res = await fetch(`${LIBROMI_BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network error — treat as transient.
    providerLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'libromi_network_error',
    );
    return { ok: false, status: 0, payload: null };
  }

  let payload: LibromiResponse | null = null;
  try {
    payload = (await res.json()) as LibromiResponse;
  } catch {
    // Some 5xx responses come back as HTML/plain text — fine, we
    // still know it failed from the status code.
  }
  return { ok: res.ok, status: res.status, payload };
}

/** Permanent error codes — do NOT retry. */
function isPermanentError(httpStatus: number, errorCode?: string): boolean {
  if (httpStatus === 401 || httpStatus === 422) return true;
  if (httpStatus === 400) return true; // INVALID_ARGUMENT — bad template/channel
  if (httpStatus === 404 || httpStatus === 405) return true;
  if (
    errorCode === 'UNAUTHENTICATED' ||
    errorCode === 'VALIDATION_ERROR' ||
    errorCode === 'INVALID_ARGUMENT' ||
    errorCode === 'ENDPOINT_NOT_FOUND' ||
    errorCode === 'RESOURCE_NOT_FOUND' ||
    errorCode === 'METHOD_NOT_ALLOWED'
  ) {
    return true;
  }
  return false;
}

export const libromiWhatsAppProvider: WhatsAppProvider = {
  name: 'libromi',
  async send(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    let token: string;
    let from: string | undefined;
    let channelId: number | undefined;
    try {
      const cfg = readLibromiConfig();
      token = cfg.token;
      from = cfg.from;
      channelId = cfg.channelId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      providerLog.error({ err: message }, 'libromi_config_missing');
      return { status: 'failed', error: message };
    }

    const body: LibromiSendBody = {
      to: input.to,
      type: 'template',
      template: input.template,
      source: 'beakn-hva',
    };
    // Prefer `from` phone over channel_id per docs (more readable in
    // logs / errors). channel_id only used if explicitly set + from is
    // not.
    if (from) body.from = from;
    else if (channelId !== undefined) body.channel_id = channelId;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const { ok, status, payload } = await postOnce(token, body);

      if (ok && payload && payload.status === 'SUCCESS') {
        providerLog.info(
          {
            target: input.to,
            templateName: input.template.name,
            messageId: payload.messageId,
            attempt,
          },
          'libromi_send_ok',
        );
        return {
          status: 'delivered',
          externalId: String(payload.messageId),
        };
      }

      const errorCode =
        payload && payload.status === 'FAILED' ? payload.error_code : undefined;
      const errMessage =
        payload && payload.status === 'FAILED'
          ? payload.message
          : `http_${status}`;

      // Permanent — fail immediately.
      if (isPermanentError(status, errorCode)) {
        providerLog.error(
          {
            target: input.to,
            templateName: input.template.name,
            httpStatus: status,
            errorCode,
            attempt,
            message: errMessage,
          },
          'libromi_send_permanent_failure',
        );
        return {
          status: 'failed',
          error: `${errorCode ?? `http_${status}`}: ${errMessage}`,
        };
      }

      // Transient — retry with backoff.
      const isLastAttempt = attempt === MAX_RETRIES;
      let waitMs: number;
      if (status === 429 && payload && payload.status === 'FAILED') {
        const retryAfter = payload.retry_after_seconds;
        waitMs =
          retryAfter && retryAfter > 0
            ? retryAfter * 1000
            : BASE_BACKOFF_MS * 2 ** (attempt - 1);
      } else {
        waitMs = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      }

      providerLog.warn(
        {
          target: input.to,
          templateName: input.template.name,
          httpStatus: status,
          errorCode,
          attempt,
          waitMs,
          willRetry: !isLastAttempt,
          message: errMessage,
        },
        'libromi_send_transient_failure',
      );

      if (isLastAttempt) {
        return {
          status: 'failed',
          error: `${errorCode ?? `http_${status}`}: ${errMessage} (after ${MAX_RETRIES} attempts)`,
        };
      }
      await sleep(waitMs);
    }
    // Unreachable — loop returns on every path.
    return { status: 'failed', error: 'libromi_send_unreachable' };
  },
};
