import { NextRequest, NextResponse } from 'next/server';
import {
  exportShotSkillDefinition,
  getShotSkillVersionForTeam,
  SHOT_SKILL_JSON_MIME,
} from '@/lib/shot-skills';
import { getWorkspaceForCurrentUser } from '@/lib/workspace/access';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const workspace = await getWorkspaceForCurrentUser();
  if (!workspace) return NextResponse.json({ error: { code: 'SKILL_EXPORT_UNAUTHORIZED', path: '$request', message: 'Authentication is required to export a Shot Skill.' } }, { status: 401 });
  const versionId = Number((await params).versionId);
  if (!Number.isSafeInteger(versionId) || versionId <= 0) return NextResponse.json({ error: { code: 'SKILL_EXPORT_VERSION_INVALID', path: '$params.versionId', message: 'Skill version ID must be a positive integer.' } }, { status: 400 });
  const entry = await getShotSkillVersionForTeam({ teamId: workspace.team.id, versionId });
  if (!entry) return NextResponse.json({ error: { code: 'SKILL_EXPORT_VERSION_NOT_FOUND', path: '$params.versionId', message: 'Shot Skill version is not available to the current Team.' } }, { status: 404 });
  if (entry.skill.ownerTeamId === null && entry.version.status === 'draft') {
    return NextResponse.json({ error: { code: 'SKILL_EXPORT_VERSION_NOT_FOUND', path: '$params.versionId', message: 'Shot Skill version is not available to the current Team.' } }, { status: 404 });
  }
  const exported = exportShotSkillDefinition(entry.definition);
  return new NextResponse(exported.content, { headers: {
    'Content-Type': SHOT_SKILL_JSON_MIME,
    'Content-Disposition': `attachment; filename="${exported.fileName}"`,
    'X-Shot-Skill-Hash': exported.fileHash,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}
