import { readFileSync } from 'node:fs';
import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

const redisUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
    message: 'must use the redis:// or rediss:// protocol'
  });

const queueEnvironmentSchema = z.object({
  REDIS_URL: redisUrl
});

const objectStorageEnvironmentSchema = z.object({
  COS_SECRET_ID: nonEmptyString,
  COS_SECRET_KEY: nonEmptyString,
  COS_BUCKET: nonEmptyString,
  COS_REGION: nonEmptyString
});

const miniMaxEnvironmentSchema = z.object({
  MINIMAX_API_KEY: nonEmptyString,
  MINIMAX_API_BASE_URL: z.string().url()
});

const videoProviderEnvironmentSchema = z.object({
  VIDEO_PROVIDER: z.enum(['minimax', 'autodl-h3']).default('minimax'),
});

const autoDlH3EnvironmentSchema = z.object({
  AUTODL_H3_API_BASE_URL: z.string().url(),
  AUTODL_H3_API_KEY: nonEmptyString.optional(),
  AUTODL_H3_API_KEY_FILE: nonEmptyString.optional(),
  AUTODL_H3_PRESET: z.enum(['draft', 'balanced', 'quality']).default('balanced'),
}).superRefine((value, context) => {
  if (!value.AUTODL_H3_API_KEY && !value.AUTODL_H3_API_KEY_FILE) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'AUTODL_H3_API_KEY or AUTODL_H3_API_KEY_FILE is required.' });
  }
});

function readEnvironment<TSchema extends z.ZodTypeAny>(schema: TSchema): z.infer<TSchema> {
  const result = schema.safeParse(process.env);

  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  throw new Error(`Invalid server environment variables: ${details}`);
}

export type QueueEnvironment = z.infer<typeof queueEnvironmentSchema>;
export type ObjectStorageEnvironment = z.infer<typeof objectStorageEnvironmentSchema>;
export type MiniMaxEnvironment = z.infer<typeof miniMaxEnvironmentSchema>;
export type VideoProviderEnvironment = z.infer<typeof videoProviderEnvironmentSchema>;
export type AutoDlH3Environment = Omit<z.infer<typeof autoDlH3EnvironmentSchema>, 'AUTODL_H3_API_KEY'> & { apiKey: string };

export function getQueueEnvironment(): QueueEnvironment {
  return readEnvironment(queueEnvironmentSchema);
}

export function getObjectStorageEnvironment(): ObjectStorageEnvironment {
  return readEnvironment(objectStorageEnvironmentSchema);
}

export function getMiniMaxEnvironment(): MiniMaxEnvironment {
  return readEnvironment(miniMaxEnvironmentSchema);
}

export function getVideoProviderEnvironment(): VideoProviderEnvironment {
  return readEnvironment(videoProviderEnvironmentSchema);
}

export function getAutoDlH3Environment(): AutoDlH3Environment {
  const environment = readEnvironment(autoDlH3EnvironmentSchema);
  let apiKey = environment.AUTODL_H3_API_KEY;
  if (!apiKey && environment.AUTODL_H3_API_KEY_FILE) {
    try {
      apiKey = readFileSync(environment.AUTODL_H3_API_KEY_FILE, 'utf8').trim();
    } catch (error) {
      throw new Error(`Could not read AUTODL_H3_API_KEY_FILE: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!apiKey) throw new Error('AutoDL H3 API key is empty.');
  const { AUTODL_H3_API_KEY: _secret, ...publicEnvironment } = environment;
  return { ...publicEnvironment, apiKey };
}
