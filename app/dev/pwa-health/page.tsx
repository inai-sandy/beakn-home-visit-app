import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

// Smoke check for PWA assets shipped in /public. Renders the manifest JSON,
// confirms sw.js + icon files exist, and reports their byte sizes. Not a
// Lighthouse audit — that needs a real Chrome instance — but covers the
// "the files we expect to ship are actually shipped" half of HVA-19.

const PUBLIC = path.join(process.cwd(), "public");
const EXPECTED_ICONS = [
  "icon-192x192.png",
  "icon-512x512.png",
  "icon-512x512-maskable.png",
  "apple-touch-icon.png",
  "favicon.ico",
];

async function statOrNull(p: string) {
  try {
    const s = await fs.stat(p);
    return { size: s.size, exists: true };
  } catch {
    return { size: 0, exists: false };
  }
}

export default async function PwaHealthPage() {
  const manifestPath = path.join(PUBLIC, "manifest.json");
  const swPath = path.join(PUBLIC, "sw.js");

  const [manifestStat, swStat] = await Promise.all([
    statOrNull(manifestPath),
    statOrNull(swPath),
  ]);

  let manifestParsed: unknown = null;
  let manifestError: string | null = null;
  if (manifestStat.exists) {
    try {
      manifestParsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    } catch (err) {
      manifestError = err instanceof Error ? err.message : String(err);
    }
  }

  const icons = await Promise.all(
    EXPECTED_ICONS.map(async (name) => ({ name, ...(await statOrNull(path.join(PUBLIC, name))) })),
  );

  const allPresent =
    manifestStat.exists && !manifestError && swStat.exists && icons.every((i) => i.exists);

  return (
    <main className="p-8 font-mono text-sm space-y-6">
      <h1 className="text-lg font-semibold">PWA service health</h1>
      <p
        className={
          allPresent
            ? "text-green-700 dark:text-green-400"
            : "text-red-700 dark:text-red-400"
        }
      >
        Overall: {allPresent ? "OK — all assets present" : "MISSING ONE OR MORE ASSETS"}
      </p>

      <section>
        <h2 className="font-semibold mb-2">manifest.json</h2>
        <pre className="bg-muted p-4 rounded-md">
{JSON.stringify(
  {
    path: "/manifest.json",
    exists: manifestStat.exists,
    size: manifestStat.size,
    parseError: manifestError,
    parsed: manifestParsed,
  },
  null,
  2,
)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">sw.js</h2>
        <pre className="bg-muted p-4 rounded-md">
{JSON.stringify({ path: "/sw.js", exists: swStat.exists, size: swStat.size }, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Icons in /public/</h2>
        <table className="border-collapse w-full text-xs">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">file</th>
              <th className="p-2">exists</th>
              <th className="p-2">size</th>
            </tr>
          </thead>
          <tbody>
            {icons.map((i) => (
              <tr key={i.name} className="border-b">
                <td className="p-2">/{i.name}</td>
                <td className="p-2">{i.exists ? "✓" : "✗"}</td>
                <td className="p-2">{i.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
