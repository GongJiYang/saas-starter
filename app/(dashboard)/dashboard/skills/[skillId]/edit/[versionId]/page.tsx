import { notFound, redirect } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { compileShotSkillLibraryPreview } from '@/lib/shot-skills/library';
import { getShotSkillDetailForTeam, listShotSkillLibraryForTeam } from '@/lib/shot-skills/queries';
import { requireWorkspace } from '@/lib/workspace/access';
import { SkillEditor } from '../../../skill-editor';

export default async function EditSkillPage({ params }: { params: Promise<{ skillId: string; versionId: string }> }) {
  const workspace = await requireWorkspace();
  if (workspace.role !== 'owner') redirect('/dashboard/skills');
  const { skillId: skillIdValue, versionId: versionIdValue } = await params;
  const skillId = Number(skillIdValue);
  const versionId = Number(versionIdValue);
  if (!Number.isSafeInteger(skillId) || !Number.isSafeInteger(versionId)) notFound();
  const detail = await getShotSkillDetailForTeam({ teamId: workspace.team.id, skillId });
  const current = detail?.versions.find((entry) => entry.version.id === versionId);
  if (!detail || !current || current.scope !== 'workspace_private') notFound();
  if (current.version.status !== 'draft') redirect(`/dashboard/skills/${detail.skill.id}`);
  const library = await listShotSkillLibraryForTeam({ teamId: workspace.team.id });
  const fallbackOptions = [...new Map(
    library
      .filter((entry) => entry.version.status === 'active')
      .map((entry) => [
        entry.skill.stableId,
        { id: entry.skill.stableId, label: `${entry.skill.name} (${entry.skill.stableId})` },
      ] as const),
  ).values()];
  return <div className="space-y-8">
    <section className="border-b border-gray-200 pb-6">
      <div className="flex items-center gap-2 text-sm font-medium text-orange-600"><Pencil className="size-4" />Private Skill Draft</div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">{detail.skill.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">v{current.version.version} · revision {current.version.revision}. This editor compiles structured fields; it does not provide a production Prompt override.</p>
    </section>
    <SkillEditor
      canEditStableId={detail.versions.length === 1}
      fallbackOptions={fallbackOptions}
      initialDefinition={current.definition}
      revision={current.version.revision}
      savedPreview={compileShotSkillLibraryPreview(current.definition)}
      versionId={current.version.id}
    />
  </div>;
}
