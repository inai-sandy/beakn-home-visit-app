'use client';

import { Switch } from '@/components/ui/switch';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';

import { toggleRuleAction } from '../actions';

interface Props {
  ruleId: string;
  enabled: boolean;
  label: string;
}

export function RuleToggle({ ruleId, enabled, label }: Props) {
  const { mutate, isPending } = useServerMutation(toggleRuleAction, {
    successMessage: 'Rule updated',
  });

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={enabled}
        disabled={isPending}
        onCheckedChange={(checked) => mutate({ id: ruleId, enabled: checked })}
        aria-label={label}
      />
      <span className="text-xs text-muted-foreground tabular-nums w-12">
        {enabled ? 'on' : 'off'}
      </span>
    </div>
  );
}
