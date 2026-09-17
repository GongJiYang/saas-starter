import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireWorkspace } from '@/lib/workspace/access';
import { ShotSkillImportForm } from './import-form';

export default async function ImportSkillPage() {
  const workspace = await requireWorkspace();
  if (workspace.role !== 'owner') redirect('/dashboard/skills');
  return (
    <div className="space-y-8">
      <section className="border-b border-gray-200 pb-6">
        <Link className="text-sm font-medium text-orange-700" href="/dashboard/skills">← Skill Library</Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-950">Import private Shot Skill</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only exact lowercase `.shot-skill.json` files with the vendor MIME and at most 256 KiB are accepted.
          Preview is non-mutating; confirmation creates only a current-Team Private Draft and never overwrites.
        </p>
      </section>
      <Card>
        <CardHeader><CardTitle>Import preview and safety rules</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            System Prompt overrides, case variants, scripts, executables, remote dependencies, URLs, unknown fields,
            invalid timelines, and unsafe extensions are rejected recursively before business parsing.
          </p>
          <ShotSkillImportForm />
        </CardContent>
      </Card>
    </div>
  );
}
