import { headers } from "next/headers";

import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Exercises the logger: info / warn / error (with stack) + a redact spot
// check. Doesn't echo PII back into the response — anyone with the URL can
// hit it.

export default async function LogHealthPage() {
  const h = await headers();
  const requestId = h.get("x-request-id");
  const reqLog = requestId ? log.child({ requestId, route: "/dev/log-health" }) : log;

  reqLog.info({ marker: "dev.log_health" }, "log_health_info_called");
  reqLog.warn({ marker: "dev.log_health" }, "log_health_warn_called");

  // Capture a stack from a real Error so docker logs shows the trace.
  try {
    throw new Error("smoke-test error from /dev/log-health (not a real failure)");
  } catch (err) {
    reqLog.error(
      { marker: "dev.log_health", err: err as Error },
      "log_health_error_called",
    );
  }

  // Redact verification: log a payload with a `password` field at multiple
  // depths. Pino's redact replaces them with "[REDACTED]" before write.
  // Nothing about the secret values appears in the response — checking
  // `docker logs beakn-app` proves it.
  reqLog.info(
    {
      marker: "dev.log_health",
      user: { id: "smoke-user", password: "should-not-appear-in-logs" },
      headers: { authorization: "Bearer should-not-appear", cookie: "session=should-not-appear" },
      apiKey: "should-not-appear",
    },
    "log_health_redact_test",
  );

  return (
    <main className="p-8 font-mono text-sm space-y-4">
      <h1 className="text-lg font-semibold">Logger health</h1>
      <p>
        Logger configured. Check <code>docker logs --tail 40 beakn-app</code>{" "}
        for output — you should see four JSON lines with{" "}
        <code>marker: &quot;dev.log_health&quot;</code> and the secret/password fields scrubbed to{" "}
        <code>[REDACTED]</code>.
      </p>
      <pre className="bg-muted p-4 rounded-md">
{JSON.stringify(
  {
    requestId: requestId ?? null,
    proxyAttachedRequestId: Boolean(requestId),
    expectedLogLines: 4,
    redactionPaths: ["*.password", "*.token", "headers.cookie", "headers.authorization", "apiKey"],
  },
  null,
  2,
)}
      </pre>
    </main>
  );
}
