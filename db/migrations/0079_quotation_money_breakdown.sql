-- HVA-296: CartPlus now sends the order money breakdown in data.order.
-- Store the components alongside the grand total so the request page +
-- customer /track can show Subtotal − Discount + Delivery + Tax = Total,
-- and finance can report on delivery/discount later.
--
-- Nullable (not defaulted 0): null = "partner didn't send it" (older
-- portal quotations, manual quotations), distinct from a real ₹0.
-- total_order_value_paise stays the authoritative grand total (unchanged).

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS subtotal_paise bigint,
  ADD COLUMN IF NOT EXISTS discount_paise bigint,
  ADD COLUMN IF NOT EXISTS delivery_paise bigint,
  ADD COLUMN IF NOT EXISTS tax_paise bigint;

-- Backfill from the stored raw webhook payload so existing CartPlus orders
-- show the breakdown immediately (recent payloads already carry these
-- fields; older ones lack them and stay null). Idempotent. Amounts are
-- rupee decimals → paise.
UPDATE quotations SET
  subtotal_paise = round((raw_payload #>> '{data,order,subtotal}')::numeric * 100),
  discount_paise = round((raw_payload #>> '{data,order,discount_amount}')::numeric * 100),
  delivery_paise = round((raw_payload #>> '{data,order,delivery_amount}')::numeric * 100),
  tax_paise      = round((raw_payload #>> '{data,order,tax_amount}')::numeric * 100)
WHERE source = 'portal'
  AND raw_payload #>> '{data,order,subtotal}' IS NOT NULL;
