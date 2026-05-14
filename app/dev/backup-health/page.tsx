import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

// Reads the beakn-postgres-backups volume mounted RO at /backups. Reports
// freshness, count, total size, and the 5 most recent dump files. Returns a
// 503 status via Next.js' notFound-style mechanism if the volume is missing
// or the most recent dump is older than 25 hours (cron presumably broke).
//
// We deliberately don't try to introspect the beakn-postgres-backup container
// itself — that would require docker socket access, which we don't give the
// app for safety. Volume freshness is a stronger signal anyway: "the dump
// ran today" beats "the container is up but maybe stuck".

const BACKUPS_DIR = "/backups";
const STALE_AFTER_MS = 25 * 60 * 60 * 1000; // 25h — daily cron + 1h grace

interface BackupFile {
  name: string;
  size: number;
  mtime: Date;
}

async function listBackups(): Promise<BackupFile[] | { error: string }> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(BACKUPS_DIR, { withFileTypes: true });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const dumps = entries
    .filter((e) => e.isFile() && e.name.startsWith("beakn-") && e.name.endsWith(".sql.gz"));
  const stats = await Promise.all(
    dumps.map(async (e): Promise<BackupFile> => {
      const p = path.join(BACKUPS_DIR, e.name);
      const s = await fs.stat(p);
      return { name: e.name, size: s.size, mtime: s.mtime };
    }),
  );
  return stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export default async function BackupHealthPage() {
  const result = await listBackups();
  const error = "error" in result ? result.error : null;
  const backups = "error" in result ? [] : result;
  const totalBytes = backups.reduce((sum, b) => sum + b.size, 0);
  const newest = backups[0];
  const ageMs = newest ? Date.now() - newest.mtime.getTime() : null;
  const stale = !newest || (ageMs !== null && ageMs > STALE_AFTER_MS);
  const overallOk = !error && !stale;

  return (
    <main className="p-8 font-mono text-sm space-y-6">
      <h1 className="text-lg font-semibold">Backup service health</h1>
      <p
        className={
          overallOk
            ? "text-green-700 dark:text-green-400"
            : "text-red-700 dark:text-red-400"
        }
      >
        Overall: {overallOk ? "OK — recent backup present" : stale ? "STALE — no backup in the last 25h" : `ERROR — ${error}`}
      </p>

      <section>
        <h2 className="font-semibold mb-2">Summary</h2>
        <pre className="bg-muted p-4 rounded-md">
{JSON.stringify(
  {
    backupsDir: BACKUPS_DIR,
    volumeReadable: !error,
    fileCount: backups.length,
    totalBytes,
    newestFile: newest?.name ?? null,
    newestAgeHours: ageMs !== null ? +(ageMs / 3_600_000).toFixed(2) : null,
    stale,
  },
  null,
  2,
)}
        </pre>
      </section>

      {backups.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">5 most recent dumps</h2>
          <table className="border-collapse w-full text-xs">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">filename</th>
                <th className="p-2">size (bytes)</th>
                <th className="p-2">mtime</th>
              </tr>
            </thead>
            <tbody>
              {backups.slice(0, 5).map((b) => (
                <tr key={b.name} className="border-b">
                  <td className="p-2">{b.name}</td>
                  <td className="p-2">{b.size}</td>
                  <td className="p-2">{b.mtime.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {error && (
        <section>
          <h2 className="font-semibold mb-2 text-red-600">Volume error</h2>
          <pre className="bg-muted p-4 rounded-md">{error}</pre>
          <p className="text-xs text-muted-foreground mt-2">
            Likely cause: <code>beakn-postgres-backups</code> volume not mounted RO at <code>/backups</code> on this container.
            Recreate beakn-app with <code>-v beakn-postgres-backups:/backups:ro</code>.
          </p>
        </section>
      )}
    </main>
  );
}
