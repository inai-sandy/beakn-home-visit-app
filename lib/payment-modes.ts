import { paymentDirectionEnum, paymentModeEnum } from '@/db/schema/payments';

// =============================================================================
// HVA-70: typed constants for payment mode + direction
// =============================================================================
//
// Same pattern as lib/auth/roles.ts (HVA-107): values are derived from
// the Drizzle enums so a schema change surfaces every consumer at
// compile time. Title Case preserved from HVA-14's original taxonomy.
// =============================================================================

export const PAYMENT_MODES = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank Transfer',
  CHEQUE: 'Cheque',
  CARD: 'Card',
  OTHER: 'Other',
} as const satisfies Record<string, (typeof paymentModeEnum.enumValues)[number]>;

export type PaymentMode = (typeof paymentModeEnum.enumValues)[number];

export const PAYMENT_MODE_VALUES = paymentModeEnum.enumValues;

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  Cash: 'Cash',
  UPI: 'UPI',
  'Bank Transfer': 'Bank Transfer',
  Cheque: 'Cheque',
  Card: 'Card',
  Other: 'Other',
};

export function isPaymentMode(value: unknown): value is PaymentMode {
  return (
    typeof value === 'string' &&
    (paymentModeEnum.enumValues as readonly string[]).includes(value)
  );
}

export const PAYMENT_DIRECTIONS = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
} as const satisfies Record<string, (typeof paymentDirectionEnum.enumValues)[number]>;

export type PaymentDirection = (typeof paymentDirectionEnum.enumValues)[number];

export const PAYMENT_DIRECTION_VALUES = paymentDirectionEnum.enumValues;

export function isPaymentDirection(value: unknown): value is PaymentDirection {
  return (
    typeof value === 'string' &&
    (paymentDirectionEnum.enumValues as readonly string[]).includes(value)
  );
}
