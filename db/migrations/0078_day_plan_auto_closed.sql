-- HVA-293: auto-close day plans at 23:55 IST when the exec forgets.
--
-- Adds a flag so an auto-sealed day is distinguishable from one the exec
-- closed themselves (manual closeDayAction leaves it false). Additive +
-- defaulted, so existing closed plans read as manually closed (correct —
-- they were, before this cron existed).

ALTER TABLE day_plans
  ADD COLUMN IF NOT EXISTS auto_closed boolean NOT NULL DEFAULT false;
