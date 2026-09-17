'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  confirmShotSkillImportAction,
  previewShotSkillImportAction,
  type SkillImportActionState,
} from '../actions';

const initialState: SkillImportActionState = {};

const SHOT_SKILL_JSON_MIME = 'application/vnd.skyhorse.shot-skill+json';

async function previewBrowserShotSkillFile(
  previous: SkillImportActionState,
  formData: FormData,
): Promise<SkillImportActionState> {
  const file = formData.get('file');
  if (
    file instanceof File
    && file.name.endsWith('.shot-skill.json')
    && (file.type === '' || file.type === 'application/json')
  ) {
    formData.set('file', new File([file], file.name, {
      type: SHOT_SKILL_JSON_MIME,
      lastModified: file.lastModified,
    }));
  }
  return previewShotSkillImportAction(previous, formData);
}

function ImportError({ state }: { state: SkillImportActionState }) {
  if (!state.error) return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      <p className="font-medium">{state.error.message}</p>
      <p className="mt-1 font-mono text-xs">{state.error.code} · {state.error.path}</p>
    </div>
  );
}

function ConfirmationForm({ preview }: { preview: NonNullable<SkillImportActionState['preview']> }) {
  const [state, action, pending] = useActionState(confirmShotSkillImportAction, initialState);
  const [mode, setMode] = useState(preview.target.suggestedMode);
  const [forkStableId, setForkStableId] = useState('');
  return (
    <form action={action} className="space-y-4 border-t border-gray-200 pt-5">
      <input name="previewToken" type="hidden" value={preview.token} />
      <label className="grid gap-2 text-sm font-medium text-gray-900">
        Collision mode
        <select
          className="rounded-md border border-gray-300 bg-white px-3 py-2"
          name="mode"
          onChange={(event) => setMode(event.target.value as typeof mode)}
          value={mode}
        >
          {preview.target.allowedModes.map((value) => (
            <option key={value} value={value}>
              {value === 'new_card' ? 'Create new private card' : value === 'new_version' ? 'Create current-Team new version' : 'Fork to a new stable ID'}
            </option>
          ))}
        </select>
      </label>
      {mode === 'fork' ? (
        <label className="grid gap-2 text-sm font-medium text-gray-900">
          New stable ID
          <input
            autoComplete="off"
            className="rounded-md border border-gray-300 px-3 py-2 font-mono"
            maxLength={100}
            name="forkStableId"
            onChange={(event) => setForkStableId(event.target.value)}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            placeholder={`${preview.definition.id}-fork`}
            required
            value={forkStableId}
          />
        </label>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Confirmation target: <span className="font-mono text-gray-900">{mode === 'fork' ? forkStableId || '(enter a new stable ID)' : preview.definition.id}@{mode === 'new_version' ? preview.target.targetVersion : preview.definition.version}</span> · Private Draft
      </p>
      <p className="text-xs text-muted-foreground">
        Confirmation verifies the signed Preview, re-parses the original bytes, and re-checks the current Team target. It never updates an existing row.
      </p>
      <ImportError state={state} />
      <Button disabled={pending} type="submit">{pending ? 'Confirming…' : 'Confirm private Draft import'}</Button>
    </form>
  );
}

export function ShotSkillImportForm() {
  const [state, action, pending] = useActionState(previewBrowserShotSkillFile, initialState);
  const preview = state.preview;
  return (
    <div className="space-y-5">
      <form action={action} className="grid gap-4">
        <label className="grid gap-2 text-sm font-medium text-gray-900">
          Shot Skill JSON file
          <input
            accept=".shot-skill.json,application/vnd.skyhorse.shot-skill+json"
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            name="file"
            required
            type="file"
          />
        </label>
        <p className="text-xs text-muted-foreground">Downloaded JSON files may be reported as generic JSON by the browser; this form submits an exact `.shot-skill.json` file with the vendor MIME contract. Preview is read-only and expires after 15 minutes.</p>
        <ImportError state={state} />
        <Button disabled={pending} type="submit">{pending ? 'Validating…' : 'Validate and Preview'}</Button>
      </form>

      {preview ? (
        <section className="space-y-4 rounded-md border border-gray-200 p-4" key={preview.token}>
          <div>
            <h2 className="font-semibold text-gray-950">Validated import Preview</h2>
            <p className="mt-1 text-xs font-mono text-muted-foreground">SHA-256 {preview.fileHash}</p>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="font-medium text-gray-900">File</dt><dd className="text-muted-foreground">{preview.fileName} · {preview.bytes} bytes</dd></div>
            <div><dt className="font-medium text-gray-900">Schema</dt><dd className="text-muted-foreground">Valid shot_skill_card {preview.definition.specVersion}</dd></div>
            <div><dt className="font-medium text-gray-900">Imported card</dt><dd className="text-muted-foreground">{preview.definition.name} · {preview.definition.id}@{preview.definition.version}</dd></div>
            <div><dt className="font-medium text-gray-900">Scope</dt><dd className="text-muted-foreground">{preview.teamName} · Private only</dd></div>
            <div><dt className="font-medium text-gray-900">Conflict</dt><dd className="text-muted-foreground">{preview.target.conflictLabel}</dd></div>
            <div><dt className="font-medium text-gray-900">Fallback</dt><dd className="text-muted-foreground">{preview.target.fallback.stableId ?? 'None'} · {preview.target.fallback.label}</dd></div>
            <div><dt className="font-medium text-gray-900">Target Draft</dt><dd className="text-muted-foreground">Private Draft · v{preview.target.targetVersion}</dd></div>
            <div><dt className="font-medium text-gray-900">Parent</dt><dd className="text-muted-foreground">{preview.target.parentVersion ? `v${preview.target.parentVersion} (version row ${preview.target.parentVersionId})` : 'None for new card/Fork'}</dd></div>
            <div className="sm:col-span-2"><dt className="font-medium text-gray-900">Preserved extensions</dt><dd className="text-muted-foreground">{preview.extensions.length > 0 ? preview.extensions.join(', ') : 'None'}</dd></div>
          </dl>
          <ConfirmationForm preview={preview} />
        </section>
      ) : null}
    </div>
  );
}
