import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { teamMembers, teams } from '@/lib/db/schema';
import { redirect } from 'next/navigation';

export const getWorkspaceForCurrentUser = cache(async () => {
  const user = await getUser();

  if (!user) {
    return null;
  }

  const membership = await db
    .select({
      team: teams,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.userId, user.id))
    .limit(1);

  if (membership.length === 0) {
    return null;
  }

  return {
    user,
    team: membership[0].team,
    role: membership[0].role,
  };
});

export async function requireWorkspace() {
  const workspace = await getWorkspaceForCurrentUser();

  if (!workspace) {
    redirect('/');
  }

  return workspace;
}
