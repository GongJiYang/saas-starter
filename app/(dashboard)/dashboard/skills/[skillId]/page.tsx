import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Braces, History, LibraryBig } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getShotSkillDetailForTeam,
  getShotSkillSupportedRoles,
  getShotSkillValidationEvidenceAggregateForTeam,
  getShotSkillVersionMetricsForTeam,
  type ShotSkillMetricAggregate,
} from '@/lib/shot-skills/queries';
import { compileShotSkillLibraryPreview } from '@/lib/shot-skills/library';
import type { EligibilityPredicate } from '@/lib/shot-skills/schema';
import { requireWorkspace } from '@/lib/workspace/access';
import { forkShotSkillVersionAction } from '../actions';

function rate(value: number | null): string {
  return value === null ? 'No sample yet' : `${Math.round(value * 100)}%`;
}

function describeEligibilityPredicate(predicate: EligibilityPredicate): string {
  if ('in' in predicate) return `${predicate.field} in [${predicate.in.join(', ')}]`;
  if ('gte' in predicate) return `${predicate.field} ≥ ${predicate.gte}`;
  return `${predicate.field} = ${String(predicate.equals)}`;
}

function List({ items }: { items: readonly string[] }) {
  return <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

function MetricBreakdown({ metric }: { metric: ShotSkillMetricAggregate | undefined }) {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>Attempts: {metric?.attemptCount ?? 0}</p>
      <p>QA pass: {rate(metric?.qaPassRate ?? null)} ({metric?.qaPassedCount ?? 0}/{metric?.qaSampleCount ?? 0} checked samples)</p>
      <p>Adoption: {rate(metric?.adoptionRate ?? null)} ({metric?.adoptedCount ?? 0}/{metric?.reviewedSampleCount ?? 0} reviewed samples)</p>
      <p>Rejected: {metric?.rejectedCount ?? 0}/{metric?.reviewedSampleCount ?? 0} reviewed samples</p>
      <p>Rejection causes: {metric?.rejectionReasons.map((reason) => `${reason.reasonCode} ×${reason.count}`).join(', ') || 'No rejected samples'}</p>
      <p>Retries: {rate(metric?.retryRate ?? null)} ({metric?.retryCount ?? 0}/{metric?.retrySampleCount ?? 0} attempts)</p>
      <p>Usable cost: {metric?.averageUsableCostCny === null || metric?.averageUsableCostCny === undefined ? 'No usable sample yet' : `¥${metric.averageUsableCostCny.toFixed(2)}`} ({metric?.usableCostSampleCount ?? 0} adopted samples with recorded cost)</p>
      <p>Last validated: {metric?.lastValidatedAt?.toLocaleString() ?? 'No QA sample yet'}</p>
    </div>
  );
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ skillId: string }>;
}) {
  const workspace = await requireWorkspace();
  const { skillId: skillIdParam } = await params;
  const skillId = Number(skillIdParam);
  if (!Number.isSafeInteger(skillId) || skillId <= 0) notFound();

  const detail = await getShotSkillDetailForTeam({ teamId: workspace.team.id, skillId });
  if (!detail) notFound();
  const current = detail.versions[0];
  if (!current) notFound();
  const metrics = await getShotSkillVersionMetricsForTeam({ teamId: workspace.team.id, versionIds: detail.versions.map((entry) => entry.version.id) });
  const metric = metrics.get(current.version.id);
  const preview = compileShotSkillLibraryPreview(current.definition);
  const evidence = await getShotSkillValidationEvidenceAggregateForTeam({
    teamId: workspace.team.id,
    shotSkillVersionId: current.version.id,
  });

  return (
    <div className="space-y-8">
      <section className="border-b border-gray-200 pb-6">
        <div className="flex items-center gap-2 text-sm font-medium text-orange-600"><LibraryBig className="size-4" />Shot Skill</div>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-950">{detail.skill.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{detail.skill.stableId} · v{current.version.version} · {current.scope === 'official' ? 'Official' : 'Private'} · {current.version.status}</p>
          </div>
          <div className="flex items-center gap-3">
            {workspace.role === 'owner' && current.scope === 'workspace_private' && current.version.status === 'draft' ? <Link className="text-sm font-medium text-orange-700 hover:text-orange-800" href={`/dashboard/skills/${detail.skill.id}/edit/${current.version.id}`}>Edit draft</Link> : null}
            {workspace.role === 'owner' ? <form action={forkShotSkillVersionAction}><input name="versionId" type="hidden" value={current.version.id} /><button className="text-sm font-medium text-orange-700 hover:text-orange-800" type="submit">Create Draft from version</button></form> : null}
            <Link className="inline-flex w-fit items-center gap-2 text-sm font-medium text-orange-700 hover:text-orange-800" href={`/dashboard/skills/${detail.skill.id}/versions/${current.version.id}`}><History className="size-4" />{workspace.role === 'owner' && current.scope === 'workspace_private' ? 'Version history & release' : 'Version history'}</Link>
            <Link className="text-sm font-medium text-orange-700 hover:text-orange-800" href={`/api/skills/versions/${current.version.id}/export`}>Export JSON</Link>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-sm text-muted-foreground">{current.definition.description}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card><CardHeader><CardTitle>Business goal</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{current.definition.goal}</CardContent></Card>
        <Card>
          <CardHeader><CardTitle>Eligibility</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Roles: {getShotSkillSupportedRoles(current.definition).join(', ')}</p>
            <p>All: {current.definition.eligibility.all.map(describeEligibilityPredicate).join('; ') || 'None'}</p>
            <p>Any: {current.definition.eligibility.any.map(describeEligibilityPredicate).join('; ') || 'None'}</p>
            <p>None: {current.definition.eligibility.none.map(describeEligibilityPredicate).join('; ') || 'None'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Validation evidence</CardTitle></CardHeader>
          <CardContent><MetricBreakdown metric={metric} /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Performance by product category</CardTitle></CardHeader>
        <CardContent>
          {metric?.productCategories.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {metric.productCategories.map((category) => (
                <section className="rounded-lg border p-4" key={category.productCategory}>
                  <h2 className="mb-3 font-medium text-gray-950">{category.productCategory}</h2>
                  <MetricBreakdown metric={category} />
                </section>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">No product-category samples yet.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Required inputs</CardTitle></CardHeader><CardContent><List items={current.definition.requiredInputs.map((input) => `${input.type}: ${input.minimumCount}–${input.maximumCount}, ${input.authorization}, ${input.mimeTypes.join(', ')}${input.blocking ? ' (blocking)' : ''}`)} /></CardContent></Card>
        <Card>
          <CardHeader><CardTitle>Camera and output</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <List items={[
              `Shot size: ${current.definition.camera.shotSize}`,
              `Composition: ${current.definition.camera.composition}`,
              `Movement: ${current.definition.camera.movement}`,
              `Focus: ${current.definition.camera.focus}`,
              `Lighting: ${current.definition.camera.lighting}`,
            ]} />
            <p>{current.definition.provider.id} · {current.definition.provider.ratio} · {current.definition.provider.resolution} · {current.definition.provider.durationSeconds.join(', ')} seconds</p>
            <p>Fallback: {current.definition.fallbackSkillId ?? 'None'}</p>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle>Preserve exactly</CardTitle></CardHeader><CardContent><List items={current.definition.invariants.map((rule) => `${rule.code}: ${rule.description}`)} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Never show</CardTitle></CardHeader><CardContent><List items={current.definition.forbidden.map((rule) => `${rule.code}: ${rule.description}`)} /></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
        <CardContent><ol className="space-y-3 text-sm text-muted-foreground">{current.definition.timeline.map((beat) => <li className="border-l-2 border-orange-200 pl-3" key={`${beat.fromRatio}-${beat.toRatio}`}><span className="font-medium text-gray-950">{beat.fromRatio * 100}%–{beat.toRatio * 100}%</span> · {beat.action}</li>)}</ol></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Quality contract</CardTitle></CardHeader>
        <CardContent><ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">{current.definition.qualityChecks.map((check) => <li key={check.code}><span className="font-medium text-gray-950">{check.code}</span> · {check.severity}</li>)}</ul></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Immutable production evidence</CardTitle></CardHeader>
        <CardContent>
          {evidence === null ? (
            <p className="text-sm text-muted-foreground">No production QA or review evidence yet.</p>
          ) : (
            <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
              <section>
                <h2 className="font-medium text-gray-950">Outcome boundaries</h2>
                <p className="mt-2">QA passed: {evidence.qaPassedSampleCount}/{evidence.qualitySampleCount} checked samples</p>
                <p>Adopted: {evidence.adoptedSampleCount}/{evidence.reviewedSampleCount} reviewed samples</p>
                <p>Rejected: {evidence.rejectedSampleCount}/{evidence.reviewedSampleCount} reviewed samples</p>
              </section>
              <section>
                <h2 className="font-medium text-gray-950">Reason aggregates</h2>
                <p className="mt-2">Adoption: {evidence.adoptionReasons.map((reason) => `${reason.reasonCode} ×${reason.sampleCount}`).join(', ') || 'No adopted samples'}</p>
                <p>Rejection: {evidence.rejectionReasons.map((reason) => `${reason.reasonCode} ×${reason.sampleCount}`).join(', ') || 'No rejected samples'}</p>
              </section>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Braces className="size-4" />Controlled compilation preview</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">Uses a fixed, non-production fixture. It does not create a VideoJob or call a provider. The generated production Prompt is read-only.</p>
          <section>
            <h2 className="text-sm font-semibold text-gray-950">Skill</h2>
            <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-gray-100 p-4 text-xs leading-5 text-gray-900">{JSON.stringify(preview.skill, null, 2)}</pre>
          </section>
          <section>
            <h2 className="text-sm font-semibold text-gray-950">Provider-neutral Recipe</h2>
            <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-gray-100 p-4 text-xs leading-5 text-gray-900">{JSON.stringify(preview.providerNeutralRecipe, null, 2)}</pre>
          </section>
          <section>
            <h2 className="text-sm font-semibold text-gray-950">Compilation Trace</h2>
            <ol className="mt-2 space-y-2 text-xs text-muted-foreground">
              {preview.compilationTrace.map((entry) => (
                <li className="rounded-md border p-3" key={entry.field}>
                  <span className="font-medium text-gray-950">{entry.field}</span> ← {entry.source}
                  <pre className="mt-1 overflow-auto whitespace-pre-wrap">{entry.value}</pre>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h2 className="text-sm font-semibold text-gray-950">Final Prompt</h2>
            <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-gray-950 p-4 text-xs leading-5 text-gray-100">{preview.prompt}</pre>
          </section>
          <p className="break-all font-mono text-xs text-muted-foreground">Recipe hash: {preview.recipeHash}</p>
        </CardContent>
      </Card>
    </div>
  );
}
