'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  CityOption,
  CustomerOption,
  ProductOption,
} from '@/lib/support/filter-options';

// =============================================================================
// HVA-247: Filter dropdowns shared across the 4 support list pages
// =============================================================================
//
// City / Product / Customer on all 4 pages. Dispatch-state additionally on
// /support/orders (others have it implied by the tab they live under).
//
// URL contract: ?city=<cityId>&product=<productName>&customer=<phone>&state=
// Any change resets ?page=. Search/sort/q params are preserved.
// =============================================================================

export type DispatchStateFilter = 'pending' | 'in_progress' | 'done';

interface Props {
  cities: CityOption[];
  products: ProductOption[];
  customers: CustomerOption[];
  current: {
    city: string;
    product: string;
    customer: string;
    state?: string;
  };
  /** Show the dispatch-state dropdown (only on /support/orders). */
  showState?: boolean;
}

const SENTINEL_ALL = '__all__';

export function SupportFilters({
  cities,
  products,
  customers,
  current,
  showState = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- URL push, not a mutation
  const [isPending, startTransition] = useTransition();

  function setFilter(key: 'city' | 'product' | 'customer' | 'state', value: string) {
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    if (value === SENTINEL_ALL || value === '') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function clearAll() {
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    next.delete('city');
    next.delete('product');
    next.delete('customer');
    next.delete('state');
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  const anyActive = Boolean(
    current.city || current.product || current.customer || current.state,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={current.city || SENTINEL_ALL}
        onValueChange={(v) => setFilter('city', v)}
        disabled={isPending}
      >
        <SelectTrigger className="h-9 w-[140px]">
          <SelectValue placeholder="City" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINEL_ALL}>All cities</SelectItem>
          {cities.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showState ? (
        <Select
          value={current.state || SENTINEL_ALL}
          onValueChange={(v) => setFilter('state', v)}
          disabled={isPending}
        >
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="Dispatch state" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SENTINEL_ALL}>All states</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      <Select
        value={current.product || SENTINEL_ALL}
        onValueChange={(v) => setFilter('product', v)}
        disabled={isPending}
      >
        <SelectTrigger className="h-9 w-[170px]">
          <SelectValue placeholder="Product" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINEL_ALL}>All products</SelectItem>
          {products.map((p) => (
            <SelectItem key={p.name} value={p.name}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={current.customer || SENTINEL_ALL}
        onValueChange={(v) => setFilter('customer', v)}
        disabled={isPending}
      >
        <SelectTrigger className="h-9 w-[200px]">
          <SelectValue placeholder="Customer" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINEL_ALL}>All customers</SelectItem>
          {customers.map((c) => (
            <SelectItem key={c.phone} value={c.phone}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {anyActive ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          disabled={isPending}
          className="h-9 px-2 text-xs"
        >
          <Icon name="close" size="xs" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
