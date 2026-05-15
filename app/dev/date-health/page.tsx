import {
  TIMEZONE,
  addDaysIst,
  formatIso,
  fromIstInput,
  isWeekStart,
  parseDate,
  toIst,
} from "@/lib/date";

export const dynamic = "force-dynamic";

// Smoke check for lib/date.ts. Exercises every helper, plus a round-trip
// that proves IST input parsing returns the same wall-clock string after
// formatting back. Demonstrates the "UTC stored / IST displayed" contract.

export default async function DateHealthPage() {
  const now = new Date();

  // Round-trip: take a known IST wall clock string, parse it to UTC, format
  // it back. The output should equal the input (give or take format).
  const istInput = "2026-05-15 14:30";
  const utcFromIst = fromIstInput(istInput);
  const istRoundTrip = toIst(utcFromIst);

  // Calendar-day add: late evening IST + 1 day = next calendar day.
  const lateEveningIst = fromIstInput("2026-05-15 23:00");
  const nextDay = addDaysIst(lateEveningIst, 1);

  // Forgiving parser samples.
  const fromIso = parseDate("2026-05-15T09:00:00+05:30");
  const fromDdmmyyyy = parseDate("15/05/2026");
  const fromIsoNoTz = parseDate("2026-05-15T09:00");

  const checks = {
    timezone: TIMEZONE,
    now: {
      utc_iso: formatIso(now),
      ist: toIst(now),
    },
    round_trip: {
      input_ist: istInput,
      stored_utc_iso: formatIso(utcFromIst),
      formatted_back_ist: istRoundTrip,
    },
    add_days_ist: {
      from_ist: toIst(lateEveningIst),
      plus_one_day_ist: toIst(nextDay),
      plus_one_day_utc_iso: formatIso(nextDay),
    },
    parse_samples: {
      iso_with_tz: { input: "2026-05-15T09:00:00+05:30", ist: toIst(fromIso) },
      ddmmyyyy: { input: "15/05/2026", ist: toIst(fromDdmmyyyy) },
      iso_naive_treated_as_ist: { input: "2026-05-15T09:00", ist: toIst(fromIsoNoTz) },
    },
    is_week_start: {
      now_with_default_tuesday: isWeekStart(now),
      a_known_tuesday: isWeekStart(fromIstInput("2026-05-12"), "tuesday"),
      a_known_monday: isWeekStart(fromIstInput("2026-05-11"), "tuesday"),
    },
  };

  return (
    <main className="p-8 font-mono text-sm space-y-4">
      <h1 className="text-lg font-semibold">Date helper health</h1>
      <p className="text-muted-foreground text-xs">
        Application timezone: <code>{TIMEZONE}</code>. UTC stored, IST displayed. All helpers in
        <code> lib/date.ts</code>. Convention: never call <code>new Date().toISOString()</code> for
        user-facing values — see <code>docs/decisions.md</code> ADR-002.
      </p>
      <pre className="bg-muted p-4 rounded-md">{JSON.stringify(checks, null, 2)}</pre>
    </main>
  );
}
