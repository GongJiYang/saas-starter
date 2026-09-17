import Link from 'next/link';
import { ArrowLeft, ImagePlay, ShieldCheck, Sparkles } from 'lucide-react';
import { ImageToVideoBatchWizard } from '../image-to-video-wizard';

export default function NewImageToVideoBatchPage() {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-gray-200 pb-6">
        <div>
          <Link className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 transition-colors hover:text-gray-950" href="/dashboard/batches">
            <ArrowLeft className="size-4" />
            Production batches
          </Link>
          <div className="mt-5 flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-orange-100 text-orange-700">
              <ImagePlay className="size-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">New production</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">Image-to-Video batch</h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600">
            Turn each reference image into one independent 9:16 video. Start with a shared motion direction, then refine individual prompts after upload.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5"><Sparkles className="size-3.5 text-orange-600" />MiniMax H3</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5"><ShieldCheck className="size-3.5 text-emerald-600" />Pilot before scale</span>
        </div>
      </header>

      <ImageToVideoBatchWizard />
    </div>
  );
}
