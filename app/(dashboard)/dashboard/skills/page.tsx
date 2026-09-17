import Link from 'next/link';
import { LibraryBig, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getShotSkillVersionMetricsForTeam,
  getShotSkillSupportedRoles,
  listShotSkillLibraryForTeam,
  type ShotSkillLibraryFilters,
  type ShotSkillMetricAggregate,
} from '@/lib/shot-skills/queries';
import { requireWorkspace } from '@/lib/workspace/access';

const statuses = ['draft', 'testing', 'active', 'deprecated', 'retired'] as const;
const shotRoles = ['hook', 'shared_body', 'proof', 'hero', 'transition'] as const;

function rate(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function MetricSummary({ metric }: { metric: ShotSkillMetricAggregate | undefined }) {
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <p><span className="font-medium text-gray-950">Attempts:</span> {metric?.attemptCount ?? 0}</p>
      <p><span className="font-medium text-gray-950">QA pass:</span> {rate(metric?.qaPassRate ?? null)} <span className="text-muted-foreground">({metric?.qaPassedCount ?? 0}/{metric?.qaSampleCount ?? 0} checked)</span></p>
      <p><span className="font-medium text-gray-950">Adoption:</span> {rate(metric?.adoptionRate ?? null)} <span className="text-muted-foreground">({metric?.adoptedCount ?? 0}/{metric?.reviewedSampleCount ?? 0} reviewed)</span></p>
      <p><span className="font-medium text-gray-950">Rejected:</span> {metric?.rejectedCount ?? 0}/{metric?.reviewedSampleCount ?? 0} reviewed</p>
      <p className="sm:col-span-2"><span className="font-medium text-gray-950">Rejection causes:</span> {metric?.rejectionReasons.map((reason) => `${reason.reasonCode} ×${reason.count}`).join(', ') || 'No rejected samples'}</p>
      <p><span className="font-medium text-gray-950">Retries:</span> {rate(metric?.retryRate ?? null)} <span className="text-muted-foreground">({metric?.retryCount ?? 0}/{metric?.retrySampleCount ?? 0} attempts)</span></p>
      <p><span className="font-medium text-gray-950">Usable cost:</span> {metric?.averageUsableCostCny === null || metric?.averageUsableCostCny === undefined ? '—' : `¥${metric.averageUsableCostCny.toFixed(2)}`} <span className="text-muted-foreground">({metric?.usableCostSampleCount ?? 0} adopted samples with cost)</span></p>
      <p><span className="font-medium text-gray-950">Last validated:</span> {metric?.lastValidatedAt?.toLocaleString() ?? 'No QA sample yet'}</p>
    </div>
  );
}

function parseFilters(value: Record<string, string | string[] | undefined>): ShotSkillLibraryFilters {
  const scope = value.scope;
  const status = value.status;
  const shotRole = value.shotRole;
  const detailImages = value.detailImages;
  return {
    scope: scope === 'official' || scope === 'workspace_private' ? scope : undefined,
    status: typeof status === 'string' && statuses.includes(status as typeof statuses[number]) ? status as typeof statuses[number] : undefined,
    shotRole: typeof shotRole === 'string' && shotRoles.includes(shotRole as typeof shotRoles[number]) ? shotRole as typeof shotRoles[number] : undefined,
    requiresDetailImages: detailImages === 'yes' ? true : detailImages === 'no' ? false : undefined,
  };
}

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const workspace = await requireWorkspace();
  const filters = parseFilters(await searchParams);
  const skills = await listShotSkillLibraryForTeam({ teamId: workspace.team.id, filters });
  const metrics = await getShotSkillVersionMetricsForTeam({
    teamId: workspace.team.id,
    versionIds: skills.map((entry) => entry.version.id),
  });

  return (
    <div className="space-y-8">
      <section className="border-b border-gray-200 pb-6">
        <div className="flex items-center gap-2 text-sm font-medium text-orange-600">
          <LibraryBig className="size-4" />
          Shot Skills
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">Skill Library</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Versioned production methods. Skills define eligibility, timeline, constraints, and the quality contract; they do not expose a free-form production Prompt.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {workspace.role === 'owner' ? 'Create and manage private Skill drafts for this workspace.' : 'You have read-only access to this workspace Skill Library.'}
          </p>
          {workspace.role === 'owner' ? <div className="flex gap-2"><Link className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white" href="/dashboard/skills/new">New private Skill</Link><Link className="rounded-md border px-3 py-2 text-sm font-medium text-gray-800" href="/dashboard/skills/import">Import JSON</Link></div> : null}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="size-4" />Filter Skills</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-4">
            <label className="grid gap-1 text-sm font-medium text-gray-700">Scope
              <select className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue={filters.scope ?? ''} name="scope">
                <option value="">All accessible</option>
                <option value="official">Official</option>
                <option value="workspace_private">Private</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-gray-700">Status
              <select className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue={filters.status ?? ''} name="status">
                <option value="">All statuses</option>
                {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-gray-700">Shot role
              <select className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue={filters.shotRole ?? ''} name="shotRole">
                <option value="">All roles</option>
                {shotRoles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-gray-700">Detail images
              <select className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue={filters.requiresDetailImages === undefined ? '' : filters.requiresDetailImages ? 'yes' : 'no'} name="detailImages">
                <option value="">Any requirement</option>
                <option value="yes">Required</option>
                <option value="no">Not required</option>
              </select>
            </label>
            <button className="w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white sm:col-span-4" type="submit">Apply filters</button>
          </form>
        </CardContent>
      </Card>

      {skills.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No accessible Skills match these structured filters.</CardContent></Card>
      ) : (
        <div className="grid gap-4">
          {skills.map((entry) => {
            const metric = metrics.get(entry.version.id);
            return (
              <Card key={entry.version.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle><Link className="hover:text-orange-700" href={`/dashboard/skills/${entry.skill.id}`}>{entry.skill.name}</Link></CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">{entry.skill.stableId} · v{entry.version.version} · {entry.scope === 'official' ? 'Official' : 'Private'}</p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{entry.version.status}</span>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <p className="text-sm text-muted-foreground">{entry.definition.description}</p>
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <p><span className="font-medium text-gray-950">Roles:</span> {getShotSkillSupportedRoles(entry.definition).join(', ')}</p>
                    <p><span className="font-medium text-gray-950">Inputs:</span> {entry.definition.requiredInputs.map((input) => `${input.type} ×${input.minimumCount}`).join(', ') || 'None'}</p>
                  </div>
                  <MetricSummary metric={metric} />
                  <details className="rounded-lg border p-3">
                    <summary className="cursor-pointer text-sm font-medium text-gray-950">Product-category aggregates ({metric?.productCategories.length ?? 0})</summary>
                    {metric?.productCategories.length ? (
                      <div className="mt-4 space-y-5">
                        {metric.productCategories.map((category) => (
                          <section key={category.productCategory}>
                            <h3 className="mb-2 text-sm font-medium text-gray-950">{category.productCategory}</h3>
                            <MetricSummary metric={category} />
                          </section>
                        ))}
                      </div>
                    ) : <p className="mt-3 text-sm text-muted-foreground">No product-category samples yet.</p>}
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
