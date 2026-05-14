import { getAllConfig, getConfig } from '@/lib/config';
import { CONFIG_SCHEMA, type ConfigKey } from '@/lib/config-schema';

export const dynamic = 'force-dynamic';

// Verifies the runtime config service end-to-end:
//  - getConfig works for individual keys of different value types (string, number)
//  - getAllConfig returns a complete snapshot
//  - TS narrows the per-key return type at call sites
//
// Page is intentionally minimal; promoted to a real admin Settings Hub page
// (HVA-?? Settings UI) later.
export default async function ConfigHealthPage() {
  const dayPlanCutoff = await getConfig('day_plan_cutoff_time');
  const redFlagRatio = await getConfig('red_flag_payment_ratio_threshold');
  const aiProvider = await getConfig('ai_provider');

  const snapshot = await getAllConfig();
  const totalKeys = Object.keys(CONFIG_SCHEMA).length;

  return (
    <main className="p-8 font-mono text-sm space-y-6">
      <h1 className="text-lg font-semibold">Config service health</h1>

      <section>
        <h2 className="font-semibold mb-2">3-key spot check (typed via ConfigValueOf&lt;K&gt;)</h2>
        <pre className="bg-muted p-4 rounded-md">
{JSON.stringify(
  {
    day_plan_cutoff_time: { value: dayPlanCutoff, jsType: typeof dayPlanCutoff },
    red_flag_payment_ratio_threshold: { value: redFlagRatio, jsType: typeof redFlagRatio },
    ai_provider: { value: aiProvider, jsType: typeof aiProvider },
  },
  null,
  2,
)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">
          Full snapshot ({Object.keys(snapshot).length} of {totalKeys} keys)
        </h2>
        <pre className="bg-muted p-4 rounded-md">
{JSON.stringify(
  Object.fromEntries(
    (Object.entries(snapshot) as [ConfigKey, unknown][]).map(([k, v]) => [
      k,
      {
        value: v,
        category: CONFIG_SCHEMA[k].category,
        type: CONFIG_SCHEMA[k].type,
        editable: CONFIG_SCHEMA[k].editable,
      },
    ]),
  ),
  null,
  2,
)}
        </pre>
      </section>
    </main>
  );
}
