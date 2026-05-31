-- HVA-201: seed default weights for the leaderboard's composite "Beakn Score".
--
-- Each metric is normalised (value ÷ max-across-execs × 100) at query time,
-- then weighted-summed using these weights. Admin can tune via Settings
-- (when that UI lands); the runtime renormalises if the weights don't sum
-- to 1.0, so partial edits don't break the ranking.
--
-- Idempotent. ON CONFLICT DO NOTHING preserves any prior tuning if the
-- migration is re-run.

INSERT INTO config (key, category, description, value) VALUES
  (
    'leaderboard_composite_weights',
    'targets',
    'Weights blended to compute the "Beakn Score" composite on /leaderboard. Each metric value is normalised (value ÷ max-across-execs × 100), then weighted-summed. Keys: revenue, conversion_pct, orders, visits, quotations, task_completion_pct. Runtime renormalises if these do not sum to 1.0.',
    '{
      "revenue": 0.35,
      "conversion_pct": 0.20,
      "orders": 0.15,
      "visits": 0.10,
      "quotations": 0.10,
      "task_completion_pct": 0.10
    }'::jsonb
  )
ON CONFLICT (key) DO NOTHING;
