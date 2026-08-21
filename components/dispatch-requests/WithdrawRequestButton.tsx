'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cancelDispatchRequestAction } from '@/lib/dispatch-requests/actions';

// HVA-342: withdrawing releases the units the request was holding, so the exec
// can ask for them again. Only offered while something is still undecided —
// the server refuses a finished request, and a control that only ever errors
// is worse than no control.

export function WithdrawRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelDispatchRequestAction(requestId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success('Request withdrawn');
          router.refresh();
        })
      }
    >
      {isPending ? 'Withdrawing…' : 'Withdraw'}
    </Button>
  );
}
