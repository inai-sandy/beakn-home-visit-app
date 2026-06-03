'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';

interface Props {
  active: 'day' | 'week' | 'month';
  basePath: string;
}

const OPTIONS: ReadonlyArray<{ key: 'day' | 'week' | 'month'; label: string }> = [
  { key: 'day', label: 'Daily' },
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
];

export function ReportBucketToggle({ active, basePath }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function pickBucket(bucket: string) {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.set('bucket', bucket);
    next.delete('page');
    router.push(`${basePath}?${next.toString()}`);
  }

  return (
    <nav aria-label="Time bucket" className="flex flex-wrap gap-1.5">
      {OPTIONS.map((opt) => {
        const isActive = opt.key === active;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => pickBucket(opt.key)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-muted-foreground/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </nav>
  );
}
