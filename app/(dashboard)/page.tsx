import Link from 'next/link';
import { ArrowRight, ClipboardCheck, Layers3, PackageCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

const workflow = [
  {
    description: 'Submit approved product facts, target audience, campaign goal, platform, and brand guardrails.',
    icon: PackageCheck,
    title: 'Brief one SKU',
  },
  {
    description: 'Rank SKU-appropriate creative angles, choose one, then generate three controlled five-second Hook variants.',
    icon: Layers3,
    title: 'Choose an angle and test Hooks',
  },
  {
    description: 'Assemble three 30-second vertical ads with shared claims, captions, music, CTA, and approval history.',
    icon: ClipboardCheck,
    title: 'Approve finished advertisements',
  },
] as const;

export default function HomePage() {
  return (
    <main>
      <section className="border-b border-gray-200 bg-white py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">
              Private beta · 30-second SKU Ad Packs
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight text-gray-950 sm:text-6xl">
              Turn one SKU brief into three comparable 30-second advertisements.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-600">
              Select a SKU-appropriate creative angle, then test three opening Hooks against the same
              product story, approved claims, brand treatment, music, and CTA.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="rounded-full" size="lg">
                <Link href="/sign-up">
                  Create a workspace
                  <ArrowRight className="ml-2 size-5" />
                </Link>
              </Button>
              <Button asChild className="rounded-full" size="lg" variant="outline">
                <Link href="/pricing">View the Ad Pack contract</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-gray-500">
              The complete 30-second assembly and quality pipeline is under validation before paid beta.
            </p>
          </div>

          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-orange-800">SKU Campaign</p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-950">Three complete 30-second variants</h2>
            <div className="mt-6 grid gap-3">
              {['A · Hook variant + shared 25s body', 'B · Hook variant + shared 25s body', 'C · Hook variant + shared 25s body'].map(
                (direction) => (
                  <div className="rounded-xl border border-orange-100 bg-white p-4" key={direction}>
                    <p className="font-medium text-gray-950">{direction}</p>
                    <p className="mt-1 text-sm text-gray-600">
                      A finished vertical ad with captions, music, brand end card, and CTA.
                    </p>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-gray-50 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-orange-600">One comparable experiment</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">
              The Campaign is the product. Generation jobs are only execution.
            </h2>
          </div>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {workflow.map((step) => (
              <article className="rounded-2xl border border-gray-200 bg-white p-6" key={step.title}>
                <step.icon className="size-6 text-orange-600" />
                <h3 className="mt-5 text-lg font-semibold text-gray-950">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
