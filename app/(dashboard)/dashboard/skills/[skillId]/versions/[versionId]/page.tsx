import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, GitCompareArrows, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getActiveShotSkillVersionForTeam,
  getShotSkillReleaseReadinessForTeam,
  previewShotSkillFixture,
  SHOT_SKILL_PREVIEW_FIXTURE,
} from '@/lib/shot-skills';
import { diffShotSkillDefinitions } from '@/lib/shot-skills/library';
import { getShotSkillDetailForTeam } from '@/lib/shot-skills/queries';
import { requireWorkspace } from '@/lib/workspace/access';
import { forkShotSkillVersionAction } from '../../../actions';
import { ReleaseApprovalActions } from '../../../release-approval';

export default async function SkillVersionHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ skillId: string; versionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const workspace = await requireWorkspace();
  const { skillId: skillIdParam, versionId: versionIdParam } = await params;
  const skillId = Number(skillIdParam);
  const versionId = Number(versionIdParam);
  if (!Number.isSafeInteger(skillId) || !Number.isSafeInteger(versionId)) notFound();

  const detail = await getShotSkillDetailForTeam({ teamId: workspace.team.id, skillId });
  const selected = detail?.versions.find((entry) => entry.version.id === versionId);
  if (!detail || !selected) notFound();

  const requested = await searchParams;
  const findAccessibleVersion = (value: string | string[] | undefined) => {
    if (typeof value !== 'string') return undefined;
    const requestedVersionId = Number(value);
    if (!Number.isSafeInteger(requestedVersionId)) return undefined;
    return detail.versions.find((entry) => entry.version.id === requestedVersionId);
  };
  const after = findAccessibleVersion(requested.after) ?? selected;
  const before = findAccessibleVersion(requested.before)
    ?? detail.versions.find((entry) => entry.version.id === after.version.parentVersionId)
    ?? detail.versions.find((entry) => entry.version.id !== after.version.id)
    ?? after;
  const diff = diffShotSkillDefinitions(before.definition, after.definition);
  const fallback = selected.definition.fallbackSkillId
    ? await getActiveShotSkillVersionForTeam({
      teamId: workspace.team.id,
      stableId: selected.definition.fallbackSkillId,
    })
    : null;
  const releasePreview = previewShotSkillFixture({
    fixture: SHOT_SKILL_PREVIEW_FIXTURE,
    skill: selected.definition,
    fallback: fallback?.definition,
  });
  const readiness = selected.scope === 'workspace_private'
    ? await getShotSkillReleaseReadinessForTeam({
      teamId: workspace.team.id,
      versionId: selected.version.id,
    })
    : null;

  return (
    <div className="space-y-8">
      <section className="border-b border-gray-200 pb-6">
        <Link className="inline-flex items-center gap-2 text-sm font-medium text-orange-700 hover:text-orange-800" href={`/dashboard/skills/${detail.skill.id}`}><ArrowLeft className="size-4" />Back to Skill</Link>
        <div className="mt-4 flex items-center gap-2 text-sm font-medium text-orange-600"><History className="size-4" />Version history</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">{detail.skill.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Selected v{selected.version.version} · {selected.version.status} · definition hash {selected.version.definitionHash}</p>
      </section>

      <Card>
        <CardHeader><CardTitle>Accessible versions</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {detail.versions.map((entry) => (
              <li className="flex items-start justify-between gap-4 border-l-2 border-gray-200 pl-3 text-sm" key={entry.version.id}>
                <div className="flex flex-col gap-1">
                  <Link className="font-medium text-gray-950 hover:text-orange-700" href={`/dashboard/skills/${detail.skill.id}/versions/${entry.version.id}`}>v{entry.version.version} · {entry.version.status}</Link>
                  <span className="text-muted-foreground">{entry.version.parentVersionId ? `Parent version #${entry.version.parentVersionId}` : 'Initial version'} · creator #{entry.version.createdBy} · created {entry.version.createdAt.toLocaleString()}</span>
                  <span className="text-muted-foreground">{entry.version.publishedAt ? `Published ${entry.version.publishedAt.toLocaleString()}` : 'Not published'} · <span className="break-all font-mono text-xs">Hash {entry.version.definitionHash}</span></span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Link className="font-medium text-orange-700 hover:text-orange-800" href={`/api/skills/versions/${entry.version.id}/export`}>Download JSON</Link>
                  {workspace.role === 'owner' ? <form action={forkShotSkillVersionAction}><input name="versionId" type="hidden" value={entry.version.id} /><button className="font-medium text-orange-700 hover:text-orange-800" type="submit">Create Draft from this version</button></form> : null}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><GitCompareArrows className="size-4" />Structured definition diff</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <form className="grid items-end gap-4 rounded-lg border bg-gray-50 p-4 sm:grid-cols-[1fr_1fr_auto]">
            <label className="grid gap-1 text-sm font-medium text-gray-700">
              Baseline version
              <select className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue={String(before.version.id)} name="before">
                {detail.versions.map((entry) => <option key={entry.version.id} value={entry.version.id}>v{entry.version.version} · {entry.version.status}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-gray-700">
              Candidate version
              <select className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue={String(after.version.id)} name="after">
                {detail.versions.map((entry) => <option key={entry.version.id} value={entry.version.id}>v{entry.version.version} · {entry.version.status}</option>)}
              </select>
            </label>
            <button className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white" type="submit">Compare</button>
          </form>
          <p className="text-sm text-muted-foreground">Comparing baseline v{before.version.version} ({before.version.definitionHash}) with candidate v{after.version.version} ({after.version.definitionHash}). Only versions accessible to this workspace can be selected.</p>
          {diff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No behavior fields differ between these versions.</p>
          ) : (
            <div className="space-y-5">
              {diff.map((change) => (
                <section key={change.field}>
                  <h2 className="text-sm font-medium text-gray-950">{change.field}</h2>
                  <div className="mt-2 grid gap-3 lg:grid-cols-2">
                    <div><p className="mb-1 text-xs font-medium text-red-800">Baseline · v{before.version.version}</p><pre className="overflow-auto rounded-md bg-red-50 p-3 text-xs text-red-900">{change.before}</pre></div>
                    <div><p className="mb-1 text-xs font-medium text-emerald-800">Candidate · v{after.version.version}</p><pre className="overflow-auto rounded-md bg-emerald-50 p-3 text-xs text-emerald-900">{change.after}</pre></div>
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {workspace.role === 'owner' && selected.scope === 'workspace_private' && readiness ? <Card>
        <CardHeader><CardTitle>Owner release approval</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">Approval uses only this controlled pre-production Fixture and append-only release-validation evidence. It does not create a VideoJob or call a provider.</p>
          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-medium text-gray-950">Controlled Fixture and eligibility</h2>
            <pre className="overflow-auto rounded-md bg-gray-50 p-3 text-xs text-gray-800">{JSON.stringify(releasePreview.fixture, null, 2)}</pre>
            <p className="text-sm"><span className="font-medium">Version:</span> {releasePreview.eligible ? 'eligible' : 'ineligible'}</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">{releasePreview.reasons.length ? releasePreview.reasons.map((reason) => <li key={reason}>{reason}</li>) : <li>No eligibility blockers.</li>}</ul>
            <p className="text-sm"><span className="font-medium">Fallback:</span> {releasePreview.fallback ? `${releasePreview.fallback.skillId} · ${releasePreview.fallback.eligible ? 'eligible' : 'ineligible'}` : 'none available'}</p>
            <p className="text-sm text-muted-foreground">{releasePreview.selectionReason}</p>
            {releasePreview.compiled ? <><pre className="max-h-96 overflow-auto rounded-md bg-gray-950 p-4 text-xs text-gray-100">{releasePreview.compiled.prompt}</pre><details><summary className="cursor-pointer text-sm font-medium">Compilation trace</summary><div className="mt-2 space-y-1">{releasePreview.compiled.compilationTrace.map((entry) => <p className="text-xs text-muted-foreground" key={entry.field}>{entry.field} ← {entry.source}: {entry.value}</p>)}</div></details></> : null}
          </section>
          <section className="space-y-3">
            <h2 className="font-medium text-gray-950">Persisted release-validation evidence</h2>
            {readiness.evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">No controlled Fixture validation has been persisted for this version.</p>
            ) : (
              <ol className="space-y-3">
                {readiness.evidence.map((entry) => (
                  <li className="rounded-lg border p-3 text-sm" key={entry.id}>
                    <p><span className="font-medium">Evidence #{entry.id}</span> · {entry.eligible ? 'eligible' : 'ineligible'} · {entry.createdAt.toLocaleString()} by user #{entry.createdBy}</p>
                    <p className="break-all text-xs text-muted-foreground">Definition {entry.definitionHash} · Fixture {entry.fixtureHash}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{entry.selectionReason}</p>
                    {entry.reasons.length ? <ul className="mt-1 list-disc pl-5 text-sm text-red-700">{entry.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium">Persisted controlled Fixture</summary>
                      <pre className="mt-2 overflow-auto rounded-md bg-gray-50 p-3 text-xs">{JSON.stringify(entry.fixture, null, 2)}</pre>
                    </details>
                    {entry.compiledRecipe ? <details className="mt-2"><summary className="cursor-pointer text-xs font-medium">Persisted compilation trace</summary>{entry.compiledRecipe.compilationTrace.map((trace) => <p className="text-xs text-muted-foreground" key={trace.field}>{trace.field} ← {trace.source}: {trace.value}</p>)}</details> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-medium text-gray-950">Blocking reasons</h2>
            {readiness.blockers.length ? <ul className="list-disc pl-5 text-sm text-red-700">{readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className="text-sm text-green-700">No release blockers remain for this definition hash.</p>}
            {selected.version.status === 'testing' ? <ReleaseApprovalActions blockers={readiness.blockers} fixture={releasePreview.fixture} versionId={selected.version.id} /> : null}
          </section>
        </CardContent>
      </Card> : null}

    </div>
  );
}
