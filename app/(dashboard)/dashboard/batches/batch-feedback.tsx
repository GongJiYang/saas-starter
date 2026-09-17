'use client';

import { useState } from 'react';
import { BarChart3, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Feedback = { total: number; readySkuCount: number; adoptedCount: number; rejectedCount: number; adoptionRate: number; commonProblems: Array<{ cause: string; count: number; affectedSkus: string[]; suggestedAction: string }> };

export function BatchFeedback({ batchId }: { batchId: number }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [preference, setPreference] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  async function load() {
    const response = await fetch(`/api/production-batches/${batchId}/feedback`);
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Could not load feedback.');
    setFeedback(body as Feedback);
  }
  async function savePreference() {
    setSaving(true); setError(''); setSaved('');
    try {
      const response = await fetch(`/api/production-batches/${batchId}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true, preference }) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Could not save Brand Preference.');
      setSaved(`Brand Preference v${(body as { version: number }).version} saved.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save Brand Preference.'); } finally { setSaving(false); }
  }
  return <div className="border-t border-gray-100 pt-3"><Button size="sm" variant="outline" onClick={() => void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load feedback.'))}><BarChart3 className="mr-2 size-4" />Feedback summary</Button>{feedback && <div className="mt-3 grid gap-3 text-sm"><p>Adoption rate: {(feedback.adoptionRate * 100).toFixed(0)}% · adopted {feedback.adoptedCount} · rejected {feedback.rejectedCount}</p>{feedback.commonProblems.map((problem) => <div className="rounded border bg-gray-50 p-3" key={problem.cause}><b>{problem.cause}</b> · {problem.count} results · {problem.affectedSkus.join(', ')}<p className="mt-1 text-muted-foreground">Suggested: {problem.suggestedAction}</p></div>)}<div className="rounded border border-orange-200 bg-orange-50 p-3"><p className="font-medium">Save a confirmed preference</p><p className="mt-1 text-xs text-muted-foreground">This is the only action that changes future Brand Kit inputs.</p><div className="mt-2 flex gap-2"><Input aria-label="Brand Preference" value={preference} onChange={(event) => setPreference(event.target.value)} placeholder="Describe the confirmed preference" /><Button size="sm" disabled={saving || !preference.trim()} onClick={() => void savePreference()}><Save className="mr-1 size-3" />{saving ? 'Saving' : 'Save'}</Button></div></div></div>}{saved && <p className="mt-2 text-sm text-emerald-700">{saved}</p>}{error && <p className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}
