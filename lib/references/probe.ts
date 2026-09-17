import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import ffprobe from 'ffprobe-static';

const execFileAsync = promisify(execFile);

type ProbeOutput = {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }>;
};

function reduceRatio(width: number, height: number): '9:16' | '1:1' | '4:5' | '16:9' {
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(ratio - 1) < 0.02) return '1:1';
  if (Math.abs(ratio - 4 / 5) < 0.02) return '4:5';
  if (Math.abs(ratio - 16 / 9) < 0.02) return '16:9';
  throw new Error(`Unsupported reference video ratio ${width}:${height}.`);
}

export async function probeReferenceVideo(input: {
  body: Buffer;
  fileExtension: string;
}): Promise<{
  durationSeconds: number;
  ratio: '9:16' | '1:1' | '4:5' | '16:9';
  videoCodec: string;
  audioCodec: string | null;
  hasAudioTrack: boolean;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'reference-probe-'));
  const filePath = path.join(directory, `reference.${input.fileExtension}`);
  try {
    await writeFile(filePath, input.body);
    const result = await execFileAsync(ffprobe.path, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height',
      filePath,
    ], { maxBuffer: 1024 * 1024 });
    const probe = JSON.parse(result.stdout) as ProbeOutput;
    const streams = probe.streams ?? [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    if (!video?.width || !video.height || !video.codec_name) {
      throw new Error('Reference video has no readable video stream.');
    }
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    const durationSeconds = Number(probe.format?.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 900) {
      throw new Error('Reference video duration is invalid or exceeds 15 minutes.');
    }
    return {
      durationSeconds: Number(durationSeconds.toFixed(3)),
      ratio: reduceRatio(video.width, video.height),
      videoCodec: video.codec_name,
      audioCodec: audio?.codec_name ?? null,
      hasAudioTrack: Boolean(audio),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
