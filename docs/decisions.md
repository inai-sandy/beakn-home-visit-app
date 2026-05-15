# Architectural decisions

Living record of locked technical choices. New decisions append a section;
old decisions stay (don't rewrite history). When a decision is reversed,
add a follow-up section explaining why and link back.

---

## ADR-001: Zod for runtime + compile-time validation

**Status**: Adopted (HVA-22, 2026-05-14)
**Package**: `zod@^4.4.3`

### What

`zod` is the single validation library for this codebase. Schemas live in
`lib/validators/*` and are imported by:
- React Hook Form / Server Action input validators (form submissions)
- API route handlers (request body validation)
- Anywhere we parse untrusted JSON (webhook payloads, config DB reads)

Each schema also exports a TypeScript type via `z.infer<typeof Foo>` so the
compile-time and runtime contracts stay in sync from a single source.

### Why Zod over Yup / Joi / class-validator

- **Type inference**: `z.infer<typeof schema>` produces the exact TS type from
  the schema. No duplicated definitions. Yup's inference is weaker; Joi has
  none. class-validator pairs with class-transformer and requires decorators
  + emitDecoratorMetadata (clashes with Turbopack defaults).
- **Bundle size**: ~13 KB minified + gzipped. Yup is similar; Joi is ~50 KB
  (server-only history shows in the bundle).
- **Ecosystem fit**: Drizzle ORM ships `drizzle-zod` (auto-generate Zod
  schemas from Drizzle tables — useful for HVA-25+). React Hook Form has
  a first-class `zodResolver`. tRPC, if we adopt it later, is Zod-native.
- **Runtime + compile-time symmetry**: A breaking schema change forces both
  ends to update — the TS compiler stops the unrelated call sites first,
  Zod stops the rest at runtime.

### When to NOT use Zod

- Pure type-level work that never sees runtime input — just write a TS type.
- Drizzle schema definitions — those are their own DSL (in `db/schema/*`).

---

## ADR-002: date-fns for date manipulation, Asia/Kolkata as display zone

**Status**: Adopted (HVA-22, 2026-05-14)
**Packages**: `date-fns@^4.1.0`, `date-fns-tz@^3.2.0`

### What

`date-fns` + `date-fns-tz` are the only date libraries used. All
user-facing date rendering, calendar-day arithmetic, and IST input parsing
goes through `lib/date.ts` (pinned to `TIMEZONE = 'Asia/Kolkata'`).

### Why date-fns over Moment / Day.js / Luxon

- **Tree-shakeable**: import only the functions you use. Moment ships its
  entire 67 KB bundle whether you use `add` or not.
- **Immutable**: every function returns a new Date. No `mutate()` footguns
  like Moment's chained mutators.
- **Smaller bundle**: at our usage level (~10 functions across the codebase)
  date-fns adds ~8 KB minified+gzipped to the client bundle. Moment is
  ~67 KB unconditionally. Day.js is smaller still but its plugin system
  (TZ requires `dayjs/plugin/timezone` + `dayjs/plugin/utc`) is awkward
  vs. date-fns-tz's three plain functions.
- **TZ support is explicit**: `date-fns-tz` exposes `formatInTimeZone`,
  `toZonedTime`, `fromZonedTime` — no global mutable state, no plugin
  registration, no risk of one part of the app seeing UTC while another
  sees IST because of plugin-init order.

### The convention (code review checkpoint)

**NEVER call `new Date().toISOString()`, `date.toLocaleString()`, or
`date.toLocaleDateString()` directly for any user-facing value.** Always
go through `lib/date.ts`:

| Want | Use |
|---|---|
| Render to user (IST) | `toIst(date)` |
| Parse user input (IST wall clock) | `fromIstInput(s)` or `parseDate(s)` |
| Log / audit / opaque ID | `formatIso(date)` (UTC) |
| Calendar-day arithmetic | `addDaysIst(date, n)` |
| Week-start check | `isWeekStart(date, configValue)` |

Direct `Date` is fine for "compare two timestamps numerically", purely
server-internal scratch values, and any code path that never reaches a
user's screen. **When in doubt, route through `lib/date.ts` — the cost is
trivial and prevents off-by-5h30m bugs that only manifest for users
between 00:00–05:30 local time elsewhere.**

### When to NOT use date-fns

- Don't bring in Moment / Day.js as a transitive of another UI lib without
  flagging it. If a date picker bundles Moment, evaluate whether the
  bundle hit is worth the convenience vs. swapping the picker.
- Don't add `dayjs` "for one quick thing" — use date-fns or write the
  three lines of plain JS.

### Phase 1 timezone hard rule

`Asia/Kolkata`. Anything else is YAGNI for the Indian-market Phase 1
launch. When multi-region (Phase 2+) is on the table, this section gets
revisited — and the migration is "every `TIMEZONE` reference becomes a
per-user / per-org setting", which is mechanically straightforward
because of the centralisation here.
