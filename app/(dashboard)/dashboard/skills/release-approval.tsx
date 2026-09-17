'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  SHOT_SKILL_DURATION_SECONDS,
  type ShotRole,
  type ShotSkillContext,
} from '@/lib/shot-skills/schema';
import {
  activateShotSkillVersionAction,
  persistShotSkillReleaseValidationAction,
  type SkillEditorActionState,
} from './actions';

const initialState: SkillEditorActionState = {};
const roles: ShotRole[] = ['hook', 'shared_body', 'proof', 'hero', 'transition'];

function ActionResult({ state }: { state: SkillEditorActionState }) {
  if (state.errors?.length) {
    return <ul className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.errors.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.code}</code> · {error.path}: {error.message}</li>)}</ul>;
  }
  return state.success ? <p className="text-sm text-green-700">{state.success}</p> : null;
}

export function ReleaseApprovalActions({
  blockers,
  fixture,
  versionId,
}: {
  blockers: string[];
  fixture: ShotSkillContext;
  versionId: number;
}) {
  const router = useRouter();
  const [controlledFixture, setControlledFixture] = useState(fixture);
  const [validationState, validationAction, validating] = useActionState(
    persistShotSkillReleaseValidationAction,
    initialState,
  );
  const [activationState, activationAction, activating] = useActionState(
    activateShotSkillVersionAction,
    initialState,
  );
  useEffect(() => {
    if (validationState.success || activationState.success) router.refresh();
  }, [activationState.success, router, validationState.success]);

  return <div className="space-y-4">
    <form action={validationAction} className="space-y-3">
      <input name="versionId" type="hidden" value={versionId} />
      <input name="fixture" type="hidden" value={JSON.stringify(controlledFixture)} />
      <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="px-1 text-sm font-medium">Release validation Fixture</legend>
        <label className="grid gap-1 text-xs">Shot role<select className="rounded-md border px-2 py-1" onChange={(event) => setControlledFixture({ ...controlledFixture, shotRole: event.target.value as ShotRole })} value={controlledFixture.shotRole}>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
        <label className="grid gap-1 text-xs">Category<input className="rounded-md border px-2 py-1" onChange={(event) => setControlledFixture({ ...controlledFixture, productCategory: event.target.value })} value={controlledFixture.productCategory} /></label>
        <label className="grid gap-1 text-xs">Duration<select className="rounded-md border px-2 py-1" onChange={(event) => setControlledFixture({ ...controlledFixture, durationSeconds: Number(event.target.value) })} value={controlledFixture.durationSeconds}>{SHOT_SKILL_DURATION_SECONDS.map((duration) => <option key={duration} value={duration}>{duration}s</option>)}</select></label>
        <label className="grid gap-1 text-xs">Platform<input className="rounded-md border px-2 py-1" onChange={(event) => setControlledFixture({ ...controlledFixture, targetPlatform: event.target.value })} value={controlledFixture.targetPlatform} /></label>
        <label className="grid gap-1 text-xs">Detail images<input className="rounded-md border px-2 py-1" min="0" max="10" onChange={(event) => setControlledFixture({ ...controlledFixture, detailImageCount: Number(event.target.value) })} type="number" value={controlledFixture.detailImageCount} /></label>
        <label className="grid gap-1 text-xs">Person rights<select className="rounded-md border px-2 py-1" onChange={(event) => setControlledFixture({ ...controlledFixture, personRights: event.target.value as ShotSkillContext['personRights'] })} value={controlledFixture.personRights}><option value="none">none</option><option value="owned">owned</option><option value="licensed">licensed</option></select></label>
        <label className="flex items-center gap-2 text-xs"><input checked={controlledFixture.primaryImageAvailable} onChange={(event) => setControlledFixture({ ...controlledFixture, primaryImageAvailable: event.target.checked })} type="checkbox" />Primary image</label>
        <label className="flex items-center gap-2 text-xs"><input checked={controlledFixture.hasSceneBrief} onChange={(event) => setControlledFixture({ ...controlledFixture, hasSceneBrief: event.target.checked })} type="checkbox" />Scene brief</label>
      </fieldset>
      <ActionResult state={validationState} />
      <Button disabled={validating} type="submit" variant="outline">{validating ? 'Validating…' : 'Run and persist controlled Fixture validation'}</Button>
    </form>
    <form action={activationAction} className="space-y-3">
      <input name="versionId" type="hidden" value={versionId} />
      <ActionResult state={activationState} />
      <Button disabled={activating || blockers.length > 0} type="submit">{activating ? 'Activating…' : 'Approve and activate'}</Button>
    </form>
  </div>;
}
