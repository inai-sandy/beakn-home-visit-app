import { logEvent, recentAuditEvents } from '@/lib/audit';
import { getConfig, setConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Exercises the audit service end-to-end:
//  - logEvent persists a row when event_type is in audit_enabled_events.
//  - setConfig() triggers a configuration_change audit row via the wire-up in
//    lib/config.ts (no-op write — same value back — still emits the audit).
//  - recentAuditEvents reads the latest rows back.
//
// Each page hit appends two new rows so the table grows; in real use the
// 'login' event would fire once per login, configuration_change once per
// admin save.
export default async function AuditHealthPage() {
  await logEvent({
    eventType: 'login',
    actorUserId: null,
    targetEntityType: 'system',
    targetEntityId: 'smoke-test',
    afterState: { source: '/dev/audit-health', renderedAt: new Date().toISOString() },
  });

  // Round-trip a config write so the audit-via-setConfig wiring is visible
  // in the result table below. Same value back = no behaviour change.
  const cutoff = await getConfig('day_plan_cutoff_time');
  await setConfig('day_plan_cutoff_time', cutoff);

  const rows = await recentAuditEvents(5);

  return (
    <main className="p-8 font-mono text-xs space-y-6">
      <h1 className="text-lg font-semibold">Audit service health</h1>
      <p className="text-muted-foreground">
        Last 5 audit_log rows (newest first). One new <code>login</code> row was just inserted by this page hit.
      </p>

      <table className="border-collapse w-full">
        <thead>
          <tr className="text-left border-b">
            <th className="p-2">created_at</th>
            <th className="p-2">event_type</th>
            <th className="p-2">target</th>
            <th className="p-2">actor</th>
            <th className="p-2">before → after</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b align-top">
              <td className="p-2 whitespace-nowrap">{r.createdAt?.toISOString?.() ?? String(r.createdAt)}</td>
              <td className="p-2">{r.eventType}</td>
              <td className="p-2">
                {r.targetEntityType}
                {r.targetEntityId ? ` / ${r.targetEntityId}` : ''}
              </td>
              <td className="p-2">{r.actorUserId ?? '—'}</td>
              <td className="p-2">
                <pre className="text-[10px] whitespace-pre-wrap">
                  {JSON.stringify({ before: r.beforeState, after: r.afterState }, null, 2)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
