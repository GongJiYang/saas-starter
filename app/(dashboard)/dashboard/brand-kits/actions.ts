'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { activityLogs, ActivityType, brandKits } from '@/lib/db/schema';
import { requireWorkspace } from '@/lib/workspace/access';

const brandKitInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100),
  brandVoice: z.string().trim().min(1, 'Brand voice is required.').max(2_000),
  requiredElements: z
    .string()
    .trim()
    .min(1, 'Required elements are required.')
    .max(4_000),
  forbiddenElements: z
    .string()
    .trim()
    .min(1, 'Forbidden elements are required.')
    .max(4_000),
  defaultShotPreference: z
    .string()
    .trim()
    .min(1, 'Default shot preference is required.')
    .max(2_000),
});

const updateBrandKitSchema = brandKitInputSchema.extend({
  brandKitId: z.coerce.number().int().positive(),
});

export type BrandKitActionState = {
  error?: string;
  success?: string;
};

async function requireOwnerWorkspace() {
  const workspace = await requireWorkspace();

  if (workspace.role !== 'owner') {
    throw new Error('Only workspace owners can manage Brand Kits.');
  }

  return workspace;
}

export async function createBrandKit(
  _previousState: BrandKitActionState,
  formData: FormData,
): Promise<BrandKitActionState> {
  const workspace = await requireOwnerWorkspace();
  const parsed = brandKitInputSchema.safeParse({
    name: formData.get('name'),
    brandVoice: formData.get('brandVoice'),
    requiredElements: formData.get('requiredElements'),
    forbiddenElements: formData.get('forbiddenElements'),
    defaultShotPreference: formData.get('defaultShotPreference'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid Brand Kit.' };
  }

  try {
    await db.transaction(async (transaction) => {
      await transaction.insert(brandKits).values({
        ...parsed.data,
        teamId: workspace.team.id,
        createdBy: workspace.user.id,
      });
      await transaction.insert(activityLogs).values({
        teamId: workspace.team.id,
        userId: workspace.user.id,
        action: ActivityType.CREATE_BRAND_KIT,
      });
    });
  } catch {
    return { error: 'A Brand Kit with this name already exists.' };
  }

  revalidatePath('/dashboard/brand-kits');
  return { success: 'Brand Kit created.' };
}

export async function updateBrandKit(
  _previousState: BrandKitActionState,
  formData: FormData,
): Promise<BrandKitActionState> {
  const workspace = await requireOwnerWorkspace();
  const parsed = updateBrandKitSchema.safeParse({
    brandKitId: formData.get('brandKitId'),
    name: formData.get('name'),
    brandVoice: formData.get('brandVoice'),
    requiredElements: formData.get('requiredElements'),
    forbiddenElements: formData.get('forbiddenElements'),
    defaultShotPreference: formData.get('defaultShotPreference'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid Brand Kit.' };
  }

  try {
    const { brandKitId, ...input } = parsed.data;
    const updated = await db.transaction(async (transaction) => {
      const result = await transaction
        .update(brandKits)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(brandKits.id, brandKitId),
            eq(brandKits.teamId, workspace.team.id),
          ),
        )
        .returning({ id: brandKits.id });

      if (result.length === 0) {
        throw new Error('Brand Kit not found.');
      }

      await transaction.insert(activityLogs).values({
        teamId: workspace.team.id,
        userId: workspace.user.id,
        action: ActivityType.UPDATE_BRAND_KIT,
      });

      return result[0];
    });

    if (!updated) {
      return { error: 'Brand Kit not found.' };
    }
  } catch {
    return { error: 'Could not update this Brand Kit.' };
  }

  revalidatePath('/dashboard/brand-kits');
  return { success: 'Brand Kit updated.' };
}
