import { requireWorkspace } from '@/lib/workspace/access';
import { WorkspaceShell } from './workspace-shell';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const workspace = await requireWorkspace();

  return (
    <WorkspaceShell workspaceName={workspace.team.name}>
      {children}
    </WorkspaceShell>
  );
}
