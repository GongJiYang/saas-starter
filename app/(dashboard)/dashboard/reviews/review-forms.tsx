'use client';

import { useActionState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { adoptVideo, rejectVideo, type ReviewActionState } from './actions';

const initialState: ReviewActionState = {};

export function AdoptVideoForm({ videoJobId }: { videoJobId: number }) {
  const [state, formAction, isPending] = useActionState(adoptVideo, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input name="videoJobId" type="hidden" value={videoJobId} />
      <Button disabled={isPending} size="sm" type="submit">
        <Check className="size-4" />
        {isPending ? 'Adopting…' : 'Adopt'}
      </Button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700">{state.success}</p> : null}
    </form>
  );
}

export function RejectVideoForm({ videoJobId }: { videoJobId: number }) {
  const [state, formAction, isPending] = useActionState(rejectVideo, initialState);

  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-red-700">
        Do not adopt
      </summary>
      <form action={formAction} className="mt-3 grid gap-3">
        <input name="videoJobId" type="hidden" value={videoJobId} />
        <label className="grid gap-2 text-sm font-medium text-gray-900">
          Reason
          <select className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-normal" defaultValue="" name="rejectionCause" required>
            <option disabled value="">Select responsibility</option>
            <option value="technical">Technical failure</option>
            <option value="fidelity">Product fidelity</option>
            <option value="spec_mismatch">Creative Spec mismatch</option>
            <option value="preference_change">Preference change</option>
            <option value="brief_change">Brief change</option>
          </select>
          <textarea
            className="min-h-24 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-normal outline-none ring-orange-500 transition focus:ring-2"
            maxLength={2000}
            name="reason"
            placeholder="Explain what needs to change."
            required
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={isPending} size="sm" type="submit" variant="outline">
            <X className="size-4" />
            {isPending ? 'Saving…' : 'Confirm not adopted'}
          </Button>
          {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
          {state.success ? <p className="text-sm text-emerald-700">{state.success}</p> : null}
        </div>
      </form>
    </details>
  );
}
