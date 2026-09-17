'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  SHOT_SKILL_DURATION_SECONDS, SHOT_SKILL_INPUT_AUTHORIZATIONS, SHOT_SKILL_INPUT_TYPES,
  SHOT_SKILL_QUALITY_CHECK_CODES, SHOT_SKILL_RULE_CODES, shotSkillCardToEditorForm,
  type CompiledShotRecipe, type EligibilityPredicate, type ShotRole, type ShotSkillCard,
  type ShotSkillContext, type ShotSkillEditorForm,
} from '@/lib/shot-skills/schema';
import {
  previewShotSkillDraftAction,
  saveShotSkillDraftAction,
  submitShotSkillForTestingAction,
  type SkillEditorActionState,
  type SkillFixturePreviewActionState,
} from './actions';

const roles: ShotRole[] = ['hook', 'shared_body', 'proof', 'hero', 'transition'];
const eligibilityFields: EligibilityPredicate['field'][] = ['shotRole', 'productCategory', 'durationSeconds', 'targetPlatform', 'primaryImageAvailable', 'detailImageCount', 'hasSceneBrief', 'personRights'];
const initialState: SkillEditorActionState = {};
const fixturePreviewInitialState: SkillFixturePreviewActionState = {};
const initialFixture: ShotSkillContext = {
  shotRole: 'hook',
  productCategory: 'physical-product',
  durationSeconds: 5,
  targetPlatform: 'tiktok',
  primaryImageAvailable: true,
  detailImageCount: 1,
  hasSceneBrief: true,
  personRights: 'owned',
  brandVoice: 'clear, restrained, brand-safe',
  sellingPoints: 'Approved product facts supplied by the Fixture.',
  mustShowElements: ['the supplied product'],
  immutableElements: ['product shape', 'product color', 'label placement'],
  forbiddenElements: ['additional products', 'generated packaging text'],
  shotDirection: 'Follow the Skill timeline and finish on a recognizable product frame.',
};
type Eligibility = ShotSkillEditorForm['eligibility'];
type EligibilityGroup = keyof Eligibility;
type RequiredInput = ShotSkillEditorForm['requiredInputs'][number];
type SkillRule = ShotSkillEditorForm['invariants'][number];

function items(value: string): string[] { return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean); }
function defaultPredicate(field: EligibilityPredicate['field'] = 'shotRole'): EligibilityPredicate {
  switch (field) {
    case 'shotRole': return { field, in: ['hook'] };
    case 'productCategory': return { field, in: ['physical-product'] };
    case 'durationSeconds': return { field, in: [4, 5] };
    case 'targetPlatform': return { field, in: ['tiktok'] };
    case 'primaryImageAvailable': return { field, equals: true };
    case 'detailImageCount': return { field, gte: 0 };
    case 'hasSceneBrief': return { field, equals: true };
    case 'personRights': return { field, in: ['licensed'] };
  }
}

function PredicateValue({ predicate, onChange }: { predicate: EligibilityPredicate; onChange: (value: EligibilityPredicate) => void }) {
  if ('equals' in predicate) return <label className="grid gap-1 text-xs font-medium">Equals<select className="rounded-md border px-2 py-1" onChange={(event) => onChange({ ...predicate, equals: event.target.value === 'true' })} value={String(predicate.equals)}><option value="true">true</option><option value="false">false</option></select></label>;
  if ('gte' in predicate) return <label className="grid gap-1 text-xs font-medium">At least<input className="rounded-md border px-2 py-1" min="0" max="10" onChange={(event) => onChange({ ...predicate, gte: Number(event.target.value) })} type="number" value={predicate.gte} /></label>;
  if (predicate.field === 'shotRole') return <fieldset><legend className="text-xs font-medium">One of</legend><div className="flex flex-wrap gap-2">{roles.map((role) => <label className="flex gap-1 text-xs" key={role}><input checked={predicate.in.includes(role)} onChange={() => onChange({ ...predicate, in: roles.filter((candidate) => candidate === role ? !predicate.in.includes(role) : predicate.in.includes(candidate)) })} type="checkbox" />{role}</label>)}</div></fieldset>;
  if (predicate.field === 'durationSeconds') return <fieldset><legend className="text-xs font-medium">One of</legend><div className="flex flex-wrap gap-2">{SHOT_SKILL_DURATION_SECONDS.map((duration) => <label className="flex gap-1 text-xs" key={duration}><input checked={predicate.in.includes(duration)} onChange={() => onChange({ ...predicate, in: SHOT_SKILL_DURATION_SECONDS.filter((candidate) => candidate === duration ? !predicate.in.includes(duration) : predicate.in.includes(candidate)) })} type="checkbox" />{duration}s</label>)}</div></fieldset>;
  if (predicate.field === 'personRights') return <fieldset><legend className="text-xs font-medium">One of</legend><div className="flex gap-2">{(['none', 'owned', 'licensed'] as const).map((right) => <label className="flex gap-1 text-xs" key={right}><input checked={predicate.in.includes(right)} onChange={() => onChange({ ...predicate, in: (['none', 'owned', 'licensed'] as const).filter((candidate) => candidate === right ? !predicate.in.includes(right) : predicate.in.includes(candidate)) })} type="checkbox" />{right}</label>)}</div></fieldset>;
  return <label className="grid gap-1 text-xs font-medium">Allowed values<input className="rounded-md border px-2 py-1" onChange={(event) => onChange({ ...predicate, in: items(event.target.value) })} value={predicate.in.join(', ')} /></label>;
}

function EligibilityBuilder({ value, onChange }: { value: Eligibility; onChange: (value: Eligibility) => void }) {
  const set = (group: EligibilityGroup, index: number, predicate: EligibilityPredicate) => onChange({ ...value, [group]: value[group].map((entry, entryIndex) => entryIndex === index ? predicate : entry) });
  return <div className="space-y-4">{(['all', 'any', 'none'] as const).map((group) => <fieldset className="space-y-2 rounded-lg border p-3" key={group}><legend className="text-sm font-semibold">{group.toUpperCase()}</legend><p className="text-xs text-muted-foreground">{group === 'all' ? 'Every predicate matches.' : group === 'any' ? 'At least one matches when non-empty.' : 'No predicate matches.'}</p>{value[group].map((predicate, index) => <div className="grid gap-2 rounded-md bg-gray-50 p-3 sm:grid-cols-[12rem_1fr_auto]" key={`${group}-${index}`}><label className="grid gap-1 text-xs font-medium">Field<select className="rounded-md border px-2 py-1" onChange={(event) => set(group, index, defaultPredicate(event.target.value as EligibilityPredicate['field']))} value={predicate.field}>{eligibilityFields.map((field) => <option key={field}>{field}</option>)}</select></label><PredicateValue onChange={(next) => set(group, index, next)} predicate={predicate} /><Button onClick={() => onChange({ ...value, [group]: value[group].filter((_, entryIndex) => entryIndex !== index) })} type="button" variant="outline">Remove</Button></div>)}<Button onClick={() => onChange({ ...value, [group]: [...value[group], defaultPredicate()] })} type="button" variant="outline">Add {group} predicate</Button></fieldset>)}</div>;
}

function RuleEditor({ title, value, onChange }: { title: string; value: SkillRule[]; onChange: (value: SkillRule[]) => void }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-semibold">{title}</legend>{value.map((rule, index) => <div className="grid gap-2 sm:grid-cols-[14rem_1fr_auto]" key={`${rule.code}-${index}`}><label className="grid gap-1 text-xs">Code<select className="rounded-md border px-2 py-1" onChange={(event) => onChange(value.map((entry, entryIndex) => entryIndex === index ? { ...entry, code: event.target.value as SkillRule['code'] } : entry))} value={rule.code}>{(SHOT_SKILL_RULE_CODES as readonly string[]).includes(rule.code) ? null : <option value={rule.code}>{rule.code} (legacy)</option>}{SHOT_SKILL_RULE_CODES.map((code) => <option key={code}>{code}</option>)}</select></label><label className="grid gap-1 text-xs">Description<input className="rounded-md border px-2 py-1" onChange={(event) => onChange(value.map((entry, entryIndex) => entryIndex === index ? { ...entry, description: event.target.value } : entry))} value={rule.description} /></label><Button onClick={() => onChange(value.filter((_, entryIndex) => entryIndex !== index))} type="button" variant="outline">Remove</Button></div>)}<Button onClick={() => { const code = SHOT_SKILL_RULE_CODES.find((candidate) => !value.some((rule) => rule.code === candidate)); if (code) onChange([...value, { code, description: 'Describe this controlled rule.' }]); }} type="button" variant="outline">Add rule</Button></fieldset>;
}

export function SkillEditor({ initialDefinition, versionId, revision, canEditStableId, fallbackOptions, savedPreview }: { initialDefinition: ShotSkillCard; versionId: number; revision: number; canEditStableId: boolean; fallbackOptions: Array<{ id: string; label: string }>; savedPreview: CompiledShotRecipe }) {
  const router = useRouter();
  const [definition, setDefinition] = useState(() => shotSkillCardToEditorForm(initialDefinition));
  const [fixture, setFixture] = useState<ShotSkillContext>(initialFixture);
  const [currentRevision, setCurrentRevision] = useState(revision);
  const [saveState, saveAction, saving] = useActionState(saveShotSkillDraftAction, initialState);
  const [submitState, submitAction, submitting] = useActionState(submitShotSkillForTestingAction, initialState);
  const [fixtureState, fixtureAction, previewing] = useActionState(previewShotSkillDraftAction, fixturePreviewInitialState);
  useEffect(() => { if (saveState.revision) setCurrentRevision(saveState.revision); if (saveState.success) router.refresh(); }, [router, saveState.revision, saveState.success]);
  useEffect(() => { if (submitState.success) router.refresh(); }, [router, submitState.success]);
  const definitionJson = useMemo(() => JSON.stringify(definition), [definition]);
  const fixtureJson = useMemo(() => JSON.stringify(fixture), [fixture]);
  const updateInput = (type: RequiredInput['type'], update: Partial<RequiredInput>) => setDefinition((current) => ({ ...current, requiredInputs: current.requiredInputs.map((input) => input.type === type ? { ...input, ...update } : input) }));
  function toggleInput(type: RequiredInput['type'], enabled: boolean) { if (!enabled) return setDefinition((current) => ({ ...current, requiredInputs: current.requiredInputs.filter((input) => input.type !== type) })); const scene = type === 'scene_brief'; setDefinition((current) => ({ ...current, requiredInputs: [...current.requiredInputs, { type, minimumCount: 1, maximumCount: 1, authorization: scene ? 'approved' : 'licensed', mimeTypes: scene ? ['application/json', 'text/plain'] : ['image/jpeg', 'image/png', 'image/webp'], blocking: true }] })); }
  function moveBeat(index: number, direction: -1 | 1) { setDefinition((current) => { const target = index + direction; if (target < 0 || target >= current.timeline.length) return current; const timeline = [...current.timeline]; [timeline[index], timeline[target]] = [timeline[target]!, timeline[index]!]; return { ...current, timeline }; }); }
  function addBeat() { setDefinition((current) => { const timeline = [...current.timeline]; const last = timeline.at(-1); if (!last || timeline.length >= 30) return current; const midpoint = Number(((last.fromRatio + last.toRatio) / 2).toFixed(4)); timeline[timeline.length - 1] = { ...last, toRatio: midpoint }; timeline.push({ fromRatio: midpoint, toRatio: last.toRatio, action: 'Describe the next ordered beat.' }); return { ...current, timeline }; }); }

  return <div className="space-y-6"><form action={saveAction} className="space-y-6"><input name="versionId" type="hidden" value={versionId} /><input name="expectedRevision" type="hidden" value={currentRevision} /><input name="definition" type="hidden" value={definitionJson} />
    <section className="grid gap-4 rounded-xl border p-5"><div><h2 className="font-semibold">Identity</h2><p className="text-sm text-muted-foreground">Stable ID is editable only on the Skill's sole Draft and freezes afterward.</p></div><label className="grid gap-1 text-sm">Stable ID<input className="rounded-md border px-3 py-2" disabled={!canEditStableId} onChange={(event) => setDefinition({ ...definition, id: event.target.value })} value={definition.id} /></label><label className="grid gap-1 text-sm">Version<input className="rounded-md border px-3 py-2" disabled value={definition.version} /></label><label className="grid gap-1 text-sm">Name<input className="rounded-md border px-3 py-2" onChange={(event) => setDefinition({ ...definition, name: event.target.value })} value={definition.name} /></label><label className="grid gap-1 text-sm">Description<textarea className="rounded-md border px-3 py-2" onChange={(event) => setDefinition({ ...definition, description: event.target.value })} value={definition.description} /></label><label className="grid gap-1 text-sm">Tags<textarea className="rounded-md border px-3 py-2" onChange={(event) => setDefinition({ ...definition, tags: items(event.target.value) })} value={definition.tags.join('\n')} /></label></section>
    <section className="grid gap-4 rounded-xl border p-5"><h2 className="font-semibold">Goal and eligibility</h2><label className="grid gap-1 text-sm">Goal<textarea className="rounded-md border px-3 py-2" onChange={(event) => setDefinition({ ...definition, goal: event.target.value })} value={definition.goal} /></label><EligibilityBuilder onChange={(eligibility) => setDefinition({ ...definition, eligibility })} value={definition.eligibility} /></section>
    <section className="grid gap-4 rounded-xl border p-5"><h2 className="font-semibold">Required inputs</h2>{SHOT_SKILL_INPUT_TYPES.map((type) => { const input = definition.requiredInputs.find((entry) => entry.type === type); return <div className="space-y-2 rounded-md border p-3" key={type}><label className="flex gap-2 text-sm font-medium"><input checked={Boolean(input)} onChange={(event) => toggleInput(type, event.target.checked)} type="checkbox" />{type}</label>{input ? <div className="grid gap-2 sm:grid-cols-5"><label className="grid text-xs">Min<input className="border p-1" min="0" onChange={(event) => updateInput(type, { minimumCount: Number(event.target.value) })} type="number" value={input.minimumCount} /></label><label className="grid text-xs">Max<input className="border p-1" min="1" onChange={(event) => updateInput(type, { maximumCount: Number(event.target.value) })} type="number" value={input.maximumCount} /></label><label className="grid text-xs">Authorization<select className="border p-1" onChange={(event) => updateInput(type, { authorization: event.target.value as RequiredInput['authorization'] })} value={input.authorization}>{SHOT_SKILL_INPUT_AUTHORIZATIONS.map((authorization) => <option key={authorization}>{authorization}</option>)}</select></label><label className="grid text-xs">MIME<input className="border p-1" onChange={(event) => updateInput(type, { mimeTypes: items(event.target.value) })} value={input.mimeTypes.join(', ')} /></label><label className="flex items-center gap-1 text-xs"><input checked={input.blocking} onChange={(event) => updateInput(type, { blocking: event.target.checked })} type="checkbox" />Blocking</label></div> : null}</div>; })}</section>
    <section className="grid gap-3 rounded-xl border p-5"><h2 className="font-semibold">Camera grammar</h2>{(['shotSize', 'composition', 'movement', 'focus', 'lighting'] as const).map((field) => <label className="grid text-sm" key={field}>{field}<input className="rounded-md border px-3 py-2" onChange={(event) => setDefinition({ ...definition, camera: { ...definition.camera, [field]: event.target.value } })} value={definition.camera[field]} /></label>)}</section>
    <section className="grid gap-3 rounded-xl border p-5"><h2 className="font-semibold">Sortable timeline</h2><p className="text-sm text-muted-foreground">Beats must be increasing, contiguous, non-overlapping, and cover 0–1.</p>{definition.timeline.map((beat, index) => <div className="grid gap-2 sm:grid-cols-[6rem_6rem_1fr_auto]" key={index}><input aria-label={`Beat ${index + 1} from`} className="border p-1" min="0" max="1" step="0.01" onChange={(event) => setDefinition({ ...definition, timeline: definition.timeline.map((entry, i) => i === index ? { ...entry, fromRatio: Number(event.target.value) } : entry) })} type="number" value={beat.fromRatio} /><input aria-label={`Beat ${index + 1} to`} className="border p-1" min="0" max="1" step="0.01" onChange={(event) => setDefinition({ ...definition, timeline: definition.timeline.map((entry, i) => i === index ? { ...entry, toRatio: Number(event.target.value) } : entry) })} type="number" value={beat.toRatio} /><input aria-label={`Beat ${index + 1} action`} className="border p-1" onChange={(event) => setDefinition({ ...definition, timeline: definition.timeline.map((entry, i) => i === index ? { ...entry, action: event.target.value } : entry) })} value={beat.action} /><div className="flex gap-1"><Button disabled={index === 0} onClick={() => moveBeat(index, -1)} type="button" variant="outline">Up</Button><Button disabled={index === definition.timeline.length - 1} onClick={() => moveBeat(index, 1)} type="button" variant="outline">Down</Button><Button disabled={definition.timeline.length === 1} onClick={() => setDefinition({ ...definition, timeline: definition.timeline.filter((_, i) => i !== index) })} type="button" variant="outline">Remove</Button></div></div>)}<Button onClick={addBeat} type="button" variant="outline">Add beat</Button></section>
    <section className="grid gap-5 rounded-xl border p-5"><h2 className="font-semibold">Controlled constraints</h2><RuleEditor onChange={(invariants) => setDefinition({ ...definition, invariants })} title="Invariants" value={definition.invariants} /><RuleEditor onChange={(forbidden) => setDefinition({ ...definition, forbidden })} title="Forbidden" value={definition.forbidden} /></section>
    <section className="grid gap-4 rounded-xl border p-5"><h2 className="font-semibold">Fallback and quality checks</h2><label className="grid text-sm">Fallback<select className="border p-2" onChange={(event) => setDefinition({ ...definition, fallbackSkillId: event.target.value || undefined })} value={definition.fallbackSkillId ?? ''}><option value="">None</option>{fallbackOptions.filter((option) => option.id !== definition.id).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>{SHOT_SKILL_QUALITY_CHECK_CODES.map((code) => { const check = definition.qualityChecks.find((entry) => entry.code === code); return <div className="flex gap-3" key={code}><label className="flex flex-1 gap-2 text-sm"><input checked={Boolean(check)} onChange={(event) => setDefinition({ ...definition, qualityChecks: event.target.checked ? [...definition.qualityChecks, { code, severity: 'warning' }] : definition.qualityChecks.filter((entry) => entry.code !== code) })} type="checkbox" />{code}</label>{check ? <select aria-label={`${code} severity`} onChange={(event) => setDefinition({ ...definition, qualityChecks: definition.qualityChecks.map((entry) => entry.code === code ? { ...entry, severity: event.target.value as 'blocking' | 'warning' } : entry) })} value={check.severity}><option>blocking</option><option>warning</option></select> : null}</div>; })}</section>
    <section className="grid gap-4 rounded-xl border p-5"><h2 className="font-semibold">Provider output</h2><p className="text-sm text-muted-foreground">Fixed MiniMax H3 · 9:16 · 768P.</p><fieldset><legend className="text-sm">Allowed 4–15 second durations</legend><div className="flex flex-wrap gap-3">{SHOT_SKILL_DURATION_SECONDS.map((duration) => <label className="flex gap-1 text-sm" key={duration}><input checked={definition.provider.durationSeconds.includes(duration)} onChange={() => setDefinition({ ...definition, provider: { ...definition.provider, durationSeconds: SHOT_SKILL_DURATION_SECONDS.filter((candidate) => candidate === duration ? !definition.provider.durationSeconds.includes(duration) : definition.provider.durationSeconds.includes(candidate)) } })} type="checkbox" />{duration}s</label>)}</div></fieldset></section>
    {saveState.errors?.length ? <ul className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveState.errors.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.code}</code> · {error.path}: {error.message}</li>)}</ul> : null}{saveState.success ? <p className="text-sm text-green-700">{saveState.success}</p> : null}<Button disabled={saving} type="submit">{saving ? 'Saving…' : 'Save draft'}</Button>
  </form>
  <form action={fixtureAction} className="space-y-4 rounded-xl border p-5">
    <input name="definition" type="hidden" value={definitionJson} />
    <input name="fixture" type="hidden" value={fixtureJson} />
    <div>
      <h2 className="font-semibold">Controlled Fixture eligibility preview</h2>
      <p className="text-sm text-muted-foreground">Evaluates and compiles only in this request. It never creates a VideoJob or calls a provider.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm">Shot role<select className="rounded-md border px-3 py-2" onChange={(event) => setFixture({ ...fixture, shotRole: event.target.value as ShotRole })} value={fixture.shotRole}>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Product category<input className="rounded-md border px-3 py-2" onChange={(event) => setFixture({ ...fixture, productCategory: event.target.value })} value={fixture.productCategory} /></label>
      <label className="grid gap-1 text-sm">Duration<select className="rounded-md border px-3 py-2" onChange={(event) => setFixture({ ...fixture, durationSeconds: Number(event.target.value) })} value={fixture.durationSeconds}>{SHOT_SKILL_DURATION_SECONDS.map((duration) => <option key={duration} value={duration}>{duration}s</option>)}</select></label>
      <label className="grid gap-1 text-sm">Platform<input className="rounded-md border px-3 py-2" onChange={(event) => setFixture({ ...fixture, targetPlatform: event.target.value })} value={fixture.targetPlatform} /></label>
      <label className="grid gap-1 text-sm">Detail images<input className="rounded-md border px-3 py-2" min="0" max="10" onChange={(event) => setFixture({ ...fixture, detailImageCount: Number(event.target.value) })} type="number" value={fixture.detailImageCount} /></label>
      <label className="grid gap-1 text-sm">Person rights<select className="rounded-md border px-3 py-2" onChange={(event) => setFixture({ ...fixture, personRights: event.target.value as ShotSkillContext['personRights'] })} value={fixture.personRights}><option value="none">none</option><option value="owned">owned</option><option value="licensed">licensed</option></select></label>
      <label className="flex items-center gap-2 text-sm"><input checked={fixture.primaryImageAvailable} onChange={(event) => setFixture({ ...fixture, primaryImageAvailable: event.target.checked })} type="checkbox" />Primary image available</label>
      <label className="flex items-center gap-2 text-sm"><input checked={fixture.hasSceneBrief} onChange={(event) => setFixture({ ...fixture, hasSceneBrief: event.target.checked })} type="checkbox" />Scene brief available</label>
    </div>
    {fixtureState.errors?.length ? <ul className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{fixtureState.errors.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.code}</code> · {error.path}: {error.message}</li>)}</ul> : null}
    {fixtureState.preview ? <div className="space-y-3 rounded-md bg-gray-50 p-4 text-sm">
      <p><span className="font-medium">Draft:</span> {fixtureState.preview.eligible ? 'eligible' : 'ineligible'}</p>
      <ul className="list-disc pl-5">{fixtureState.preview.reasons.length ? fixtureState.preview.reasons.map((reason) => <li key={reason}>{reason}</li>) : <li>No eligibility blockers.</li>}</ul>
      <p><span className="font-medium">Fallback:</span> {fixtureState.preview.fallback ? `${fixtureState.preview.fallback.skillId} · ${fixtureState.preview.fallback.eligible ? 'eligible' : 'ineligible'}` : 'none available'}</p>
      {fixtureState.preview.fallback?.reasons.length ? <ul className="list-disc pl-5">{fixtureState.preview.fallback.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      <p><span className="font-medium">Selection:</span> {fixtureState.preview.selectionReason}</p>
      {fixtureState.preview.compiled ? <><pre className="max-h-80 overflow-auto rounded-md bg-gray-950 p-4 text-xs text-gray-100">{fixtureState.preview.compiled.prompt}</pre><details><summary>Compilation trace</summary>{fixtureState.preview.compiled.compilationTrace.map((entry) => <p className="text-xs" key={entry.field}>{entry.field} ← {entry.source}: {entry.value}</p>)}</details></> : null}
    </div> : null}
    <Button disabled={previewing} type="submit" variant="outline">{previewing ? 'Previewing…' : 'Preview Fixture'}</Button>
  </form>
  <section className="rounded-xl border p-5"><h2 className="font-semibold">Saved fixture preview</h2><pre className="mt-4 max-h-80 overflow-auto rounded-md bg-gray-950 p-4 text-xs text-gray-100">{savedPreview.prompt}</pre><details><summary>Compilation trace</summary>{savedPreview.compilationTrace.map((entry) => <p className="text-xs" key={entry.field}>{entry.field} ← {entry.source}: {entry.value}</p>)}</details></section>
  <form action={submitAction} className="rounded-xl border p-5"><input name="versionId" type="hidden" value={versionId} /><h2 className="font-semibold">Testing and release</h2>{submitState.errors?.length ? <ul className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{submitState.errors.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.code}</code> · {error.path}: {error.message}</li>)}</ul> : null}{submitState.success ? <p className="mt-3 text-sm text-green-700">{submitState.success}</p> : null}<Button className="mt-4" disabled={submitting} type="submit" variant="outline">{submitting ? 'Submitting…' : 'Submit for testing'}</Button></form>
  </div>;
}
