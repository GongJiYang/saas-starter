import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getShotSkillVersionForTeam } from '@/lib/shot-skills';
import { requireWorkspace } from '@/lib/workspace/access';
import { createShotSkillDraftAction, forkShotSkillVersionAction } from '../actions';

export default async function NewSkillPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sourceVersionId?: string; durationSeconds?: string }>;
}) {
  const workspace = await requireWorkspace();
  if (workspace.role !== 'owner') redirect('/dashboard/skills');
  const { error, sourceVersionId, durationSeconds } = await searchParams;
  const parsedSourceVersionId = Number(sourceVersionId);
  const parsedDurationSeconds = Number(durationSeconds);
  const source = Number.isSafeInteger(parsedSourceVersionId) && parsedSourceVersionId > 0
    ? await getShotSkillVersionForTeam({ teamId: workspace.team.id, versionId: parsedSourceVersionId })
    : null;

  return (
    <div className="space-y-8">
      <section className="border-b border-gray-200 pb-6">
        <Link className="text-sm font-medium text-orange-700 hover:text-orange-800" href="/dashboard/skills">← Skill Library</Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-950">New private Shot Skill</h1>
        <p className="mt-2 text-sm text-muted-foreground">Create a Draft, then define its eligibility, production grammar, constraints, and quality contract.</p>
      </section>
      {source ? (
        <Card>
          <CardHeader><CardTitle>Start from {source.skill.name}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Fork {source.skill.stableId} v{source.version.version} into this Workspace
              {Number.isSafeInteger(parsedDurationSeconds) ? ` and add ${parsedDurationSeconds}-second output support` : ''}.
              The new version starts as an editable Private Draft.
            </p>
            <form action={forkShotSkillVersionAction}>
              <input name="versionId" type="hidden" value={source.version.id} />
              {Number.isSafeInteger(parsedDurationSeconds) ? <input name="durationSeconds" type="hidden" value={parsedDurationSeconds} /> : null}
              <Button type="submit">Create Private Draft</Button>
            </form>
          </CardContent>
        </Card>
      ) : sourceVersionId ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">That Shot Skill version is not available in this Workspace.</p>
      ) : (
        <Card>
          <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
          <CardContent>
            <form action={createShotSkillDraftAction} className="grid max-w-xl gap-4">
              <label className="grid gap-1 text-sm font-medium">
                Stable ID
                <input className="rounded-md border px-3 py-2" name="stableId" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="product-turntable" required />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Name
                <input className="rounded-md border px-3 py-2" name="name" placeholder="Product turntable" required />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Description
                <textarea className="min-h-24 rounded-md border px-3 py-2" name="description" placeholder="What production pattern this Skill implements." required />
              </label>
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              <Button type="submit">Create Draft</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
