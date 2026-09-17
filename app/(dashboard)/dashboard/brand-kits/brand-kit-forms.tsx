'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  createBrandKit,
  updateBrandKit,
  type BrandKitActionState,
} from './actions';
import type { BrandKit } from '@/lib/db/schema';

const initialState: BrandKitActionState = {};

export function CreateBrandKitForm() {
  const [state, formAction, isPending] = useActionState(
    createBrandKit,
    initialState,
  );

  return (
    <form action={formAction} className="grid gap-5">
      <div className="grid gap-2">
        <label className="text-sm font-medium text-gray-900" htmlFor="name">
          Name
        </label>
        <input
          className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm outline-none ring-orange-500 transition focus:ring-2"
          id="name"
          maxLength={100}
          name="name"
          placeholder="Spring product launch"
          required
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-gray-900" htmlFor="brandVoice">
          Brand voice
        </label>
        <textarea
          className="min-h-24 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-orange-500 transition focus:ring-2"
          id="brandVoice"
          maxLength={2000}
          name="brandVoice"
          placeholder="Confident, concise, and product-led."
          required
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
        <label className="grid gap-2 text-sm font-medium text-gray-900" htmlFor="requiredElements">
          Required elements
          <textarea
            className="min-h-28 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-normal outline-none ring-orange-500 transition focus:ring-2"
            id="requiredElements"
            maxLength={4000}
            name="requiredElements"
            placeholder="Logo at end frame; product hero shot; #BrandTag"
            required
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-gray-900" htmlFor="forbiddenElements">
          Forbidden elements
          <textarea
            className="min-h-28 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-normal outline-none ring-orange-500 transition focus:ring-2"
            id="forbiddenElements"
            maxLength={4000}
            name="forbiddenElements"
            placeholder="Competitor marks; unverified claims; visible UI overlays"
            required
          />
        </label>
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-gray-900" htmlFor="defaultShotPreference">
          Default shot preference
        </label>
        <textarea
          className="min-h-24 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-orange-500 transition focus:ring-2"
          id="defaultShotPreference"
          maxLength={2000}
          name="defaultShotPreference"
          placeholder="Begin on a premium macro detail, then reveal the product in use."
          required
        />
      </div>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700">{state.success}</p> : null}
      <Button className="w-fit" disabled={isPending} type="submit">
        {isPending ? 'Creating…' : 'Create Brand Kit'}
      </Button>
    </form>
  );
}

export function EditBrandKitForm({ brandKit }: { brandKit: BrandKit }) {
  const [state, formAction, isPending] = useActionState(
    updateBrandKit,
    initialState,
  );

  return (
    <form action={formAction} className="mt-5 grid gap-5 border-t border-gray-100 pt-5">
      <input name="brandKitId" type="hidden" value={brandKit.id} />
      <div className="grid gap-2">
        <label className="text-sm font-medium text-gray-900" htmlFor={`name-${brandKit.id}`}>
          Name
        </label>
        <input
          className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm outline-none ring-orange-500 transition focus:ring-2"
          defaultValue={brandKit.name}
          id={`name-${brandKit.id}`}
          maxLength={100}
          name="name"
          required
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-gray-900" htmlFor={`brandVoice-${brandKit.id}`}>
          Brand voice
        </label>
        <textarea
          className="min-h-24 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-orange-500 transition focus:ring-2"
          defaultValue={brandKit.brandVoice}
          id={`brandVoice-${brandKit.id}`}
          maxLength={2000}
          name="brandVoice"
          required
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
        <label className="grid gap-2 text-sm font-medium text-gray-900" htmlFor={`requiredElements-${brandKit.id}`}>
          Required elements
          <textarea
            className="min-h-28 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-normal outline-none ring-orange-500 transition focus:ring-2"
            defaultValue={brandKit.requiredElements}
            id={`requiredElements-${brandKit.id}`}
            maxLength={4000}
            name="requiredElements"
            required
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-gray-900" htmlFor={`forbiddenElements-${brandKit.id}`}>
          Forbidden elements
          <textarea
            className="min-h-28 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-normal outline-none ring-orange-500 transition focus:ring-2"
            defaultValue={brandKit.forbiddenElements}
            id={`forbiddenElements-${brandKit.id}`}
            maxLength={4000}
            name="forbiddenElements"
            required
          />
        </label>
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-gray-900" htmlFor={`defaultShotPreference-${brandKit.id}`}>
          Default shot preference
        </label>
        <textarea
          className="min-h-24 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-orange-500 transition focus:ring-2"
          defaultValue={brandKit.defaultShotPreference}
          id={`defaultShotPreference-${brandKit.id}`}
          maxLength={2000}
          name="defaultShotPreference"
          required
        />
      </div>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700">{state.success}</p> : null}
      <Button className="w-fit" disabled={isPending} type="submit" variant="outline">
        {isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}
