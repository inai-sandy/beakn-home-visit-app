'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  status: string;
  sortDir: string;
  q: string;
  from: string;
  to: string;
  captainId: string;
  execId: string;
  captainFacets: Array<{ id: string; name: string }>;
  execFacets: Array<{ id: string; name: string }>;
  /** Show the captain dropdown — false for /captain/tasks where the
   *  captain only sees their own team. */
  showCaptainFacet: boolean;
  /** Show the exec dropdown — false for /tasks (exec) where the user
   *  only ever sees their own tasks. */
  showExecFacet?: boolean;
  basePath: string;
}

export function TasksTableFilters({
  status,
  sortDir,
  q,
  from,
  to,
  captainId,
  execId,
  captainFacets,
  execFacets,
  showCaptainFacet,
  showExecFacet = true,
  basePath,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(q);

  useEffect(() => {
    const trimmed = searchValue.trim();
    if (trimmed === q) return;
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params?.toString() ?? '');
      if (trimmed.length > 0) next.set('q', trimmed);
      else next.delete('q');
      next.delete('page');
      const qs = next.toString();
      startTransition(() => {
        router.push(qs.length > 0 ? `${basePath}?${qs}` : basePath);
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [searchValue, q, router, params, basePath]);

  function pushParam(key: string, value: string | null) {
    const next = new URLSearchParams(params?.toString() ?? '');
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    next.delete('page');
    const qs = next.toString();
    startTransition(() => {
      router.push(qs.length > 0 ? `${basePath}?${qs}` : basePath);
    });
  }

  function clearAll() {
    setSearchValue('');
    startTransition(() => {
      router.push(basePath);
    });
  }

  const anyActive =
    searchValue.trim().length > 0 ||
    status !== 'all' ||
    sortDir !== 'desc' ||
    from.length > 0 ||
    to.length > 0 ||
    captainId !== 'all' ||
    execId !== 'all';

  return (
    <section
      aria-label="Tasks filters"
      className="rounded-2xl border bg-card p-3 sm:p-4 space-y-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Icon
            name="search"
            size="xs"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search description or customer…"
            className="h-9 pl-9 text-sm"
            aria-label="Search tasks"
          />
        </div>

        <Select
          value={status}
          onValueChange={(v) => pushParam('status', v)}
        >
          <SelectTrigger className="h-9 w-[140px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="postponed">Postponed</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={sortDir}
          onValueChange={(v) => pushParam('dir', v === 'desc' ? null : v)}
        >
          <SelectTrigger className="h-9 w-[140px] text-sm">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Newest first</SelectItem>
            <SelectItem value="asc">Oldest first</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Label
            htmlFor="tasks-from"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            From
          </Label>
          <Input
            id="tasks-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => pushParam('from', e.target.value || null)}
            className="h-9 w-[140px] text-sm"
            aria-label="From date"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label
            htmlFor="tasks-to"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            To
          </Label>
          <Input
            id="tasks-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => pushParam('to', e.target.value || null)}
            className="h-9 w-[140px] text-sm"
            aria-label="To date"
          />
        </div>

        {showCaptainFacet && (
          <Select
            value={captainId}
            onValueChange={(v) => pushParam('captain', v)}
          >
            <SelectTrigger className="h-9 w-[160px] text-sm">
              <SelectValue placeholder="Captain" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All captains</SelectItem>
              {captainFacets.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {showExecFacet && (
          <Select value={execId} onValueChange={(v) => pushParam('exec', v)}>
            <SelectTrigger className="h-9 w-[170px] text-sm">
              <SelectValue placeholder="Executive" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All execs</SelectItem>
              {execFacets.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {anyActive && (
          <button
            type="button"
            onClick={clearAll}
            disabled={pending}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon name="close" size="xs" />
            Clear
          </button>
        )}
      </div>
    </section>
  );
}
