import { Palette } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listBrandKitsForTeam } from '@/lib/db/video-queries';
import { requireWorkspace } from '@/lib/workspace/access';
import { CreateBrandKitForm, EditBrandKitForm } from './brand-kit-forms';

export default async function BrandKitsPage() {
  const workspace = await requireWorkspace();
  const brandKits = await listBrandKitsForTeam(workspace.team.id);
  const isOwner = workspace.role === 'owner';

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-2 border-b border-gray-200 pb-6">
        <div className="flex items-center gap-2 text-sm font-medium text-orange-600">
          <Palette className="size-4" />
          Brand kits
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-950">
          Brand guardrails
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Define the non-negotiable voice, elements, and shot preferences that
          future Campaigns must follow.
        </p>
      </section>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>Create a Brand Kit</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateBrandKitForm />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Only workspace owners can create or edit Brand Kits.
          </CardContent>
        </Card>
      )}

      <section aria-label="Saved Brand Kits" className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-950">Saved Brand Kits</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {brandKits.length === 0
              ? 'No Brand Kits yet.'
              : `${brandKits.length} available to this workspace.`}
          </p>
        </div>
        {brandKits.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Create the first Brand Kit to establish campaign guardrails.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {brandKits.map((brandKit) => (
              <Card key={brandKit.id}>
                <CardHeader>
                  <CardTitle>{brandKit.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{brandKit.brandVoice}</p>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <p className="font-medium text-gray-900">Required</p>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                      {brandKit.requiredElements}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Forbidden</p>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                      {brandKit.forbiddenElements}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Shot preference</p>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                      {brandKit.defaultShotPreference}
                    </p>
                  </div>
                  {isOwner ? (
                    <details className="sm:col-span-3">
                      <summary className="cursor-pointer text-sm font-medium text-orange-700">
                        Edit Brand Kit
                      </summary>
                      <EditBrandKitForm brandKit={brandKit} />
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
