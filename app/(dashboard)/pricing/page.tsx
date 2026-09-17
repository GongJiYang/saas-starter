import Link from 'next/link';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

const deliverables = [
  '3 ranked creative-angle proposals, followed by 3 Hook variants for the selected angle',
  '1 shared 25-second product story and CTA structure',
  '3 assembled 30-second vertical ad variants',
  'Approved-claim captions, brand end card, and licensed or customer-supplied music',
  'Campaign-level comparison, approval, and download',
] as const;

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">
          Product repositioning · private beta
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-gray-950">
          A 30-second SKU ad pack, not a five-second generation credit.
        </h1>
        <p className="mt-4 text-base leading-7 text-gray-600">
          The earlier five-second candidate prices have been withdrawn. Short H3 clips are production
          shots; the customer deliverable is a complete, reviewable advertisement.
        </p>
      </div>

      <article className="mx-auto mt-12 max-w-3xl rounded-2xl border border-orange-200 bg-orange-50 p-8">
        <p className="text-sm font-semibold text-orange-700">SKU Hook Test Ad Pack</p>
        <h2 className="mt-2 text-3xl font-semibold text-gray-950">Three 30-second ad variants</h2>
        <p className="mt-3 text-sm leading-6 text-gray-700">
          The three ads share the same product facts, approved claims, brand treatment, body, and CTA.
          Only the first five-second hook changes, so the Campaign can compare a controlled creative variable.
        </p>
        <ul className="mt-6 grid gap-3">
          {deliverables.map((deliverable) => (
            <li className="flex items-start gap-2 text-sm text-gray-800" key={deliverable}>
              <Check className="mt-0.5 size-4 shrink-0 text-orange-600" />
              {deliverable}
            </li>
          ))}
        </ul>
        <p className="mt-7 rounded-xl bg-white p-4 text-sm text-gray-600">
          Price validation is paused until this complete 30-second pipeline is generated and reviewed end to end.
          WeChat Pay checkout remains closed.
        </p>
        <Button asChild className="mt-6 rounded-full" variant="outline">
          <Link href="/sign-up">Join the private beta</Link>
        </Button>
      </article>
    </main>
  );
}
