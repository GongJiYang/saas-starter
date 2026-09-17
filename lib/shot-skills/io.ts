import { createHash } from 'node:crypto';
import { stableStringify } from './compiler';
import { shotSkillCardSchema, shotSkillEditorFormSchema, type ShotSkillCard } from './schema';

export const SHOT_SKILL_JSON_MIME = 'application/vnd.skyhorse.shot-skill+json';
export const SHOT_SKILL_JSON_MAX_BYTES = 256 * 1024;
export const SHOT_SKILL_JSON_MAX_DEPTH = 20;

export type ShotSkillImportErrorCode =
  | 'SKILL_IMPORT_FILE_REQUIRED'
  | 'SKILL_IMPORT_INVALID_EXTENSION'
  | 'SKILL_IMPORT_INVALID_MIME'
  | 'SKILL_IMPORT_INVALID_SIZE'
  | 'SKILL_IMPORT_INVALID_UTF8'
  | 'SKILL_IMPORT_INVALID_JSON'
  | 'SKILL_IMPORT_MAX_DEPTH'
  | 'SKILL_IMPORT_DANGEROUS_FIELD'
  | 'SKILL_IMPORT_DANGEROUS_VALUE'
  | 'SKILL_IMPORT_SCHEMA_UNKNOWN_FIELD'
  | 'SKILL_IMPORT_SCHEMA_INVALID';

export type ShotSkillImportIssue = {
  code: ShotSkillImportErrorCode;
  path: string;
  message: string;
};

export class ShotSkillImportValidationError extends Error {
  readonly code: ShotSkillImportErrorCode;
  readonly path: string;

  constructor(issue: ShotSkillImportIssue) {
    super(issue.message);
    this.name = 'ShotSkillImportValidationError';
    this.code = issue.code;
    this.path = issue.path;
  }

  toIssue(): ShotSkillImportIssue {
    return { code: this.code, path: this.path, message: this.message };
  }
}

export type ShotSkillImportPreview = {
  definition: ShotSkillCard;
  fileHash: string;
  bytes: number;
  extensions: string[];
};

const dangerousKeyNames: Record<string, boolean> = {
  binary: true,
  binaries: true,
  command: true,
  commands: true,
  dependency: true,
  constructor: true,
  dependencies: true,
  endpoint: true,
  endpoints: true,
  executable: true,
  executables: true,
  href: true,
  package: true,
  packages: true,
  plugin: true,
  proto: true,
  prototype: true,
  plugins: true,
  remotedependency: true,
  remotedependencies: true,
  script: true,
  scripts: true,
  shell: true,
  systemprompt: true,
  uri: true,
  uris: true,
  url: true,
  urls: true,
  webhook: true,
  webhooks: true,
};
const urlLikeValue = /(?:https?|ftp|file|data|javascript|vbscript|mailto|npm|ssh):|git\+|(?:^|[\s"'(])\/\/[a-z0-9]|\bwww\./i;
const scriptLikeValue = /(?:<script\b|#!\s*\/|(?:^|[^\w])eval\s*\(|(?:^|[^\w])require\s*\(|child_process|npm\s+(?:install|exec)|\b(?:curl|wget)\s+-?\S*|\b(?:function|class)\s+\w*\s*\(|=>|console\.\w+|process\.\w+|document\.\w+|window\.\w+|\b(?:bash|powershell)\s+-[a-z]*c\b|\brm\s+-rf\b)/i;
const executableValue = /\.(?:apk|app|bat|bin|cmd|com|cpl|dll|dmg|exe|hta|jar|js|jse|msi|msp|ps1|py|rb|scr|sh|so|vbe|vbs|wsf)(?:$|[?#\s])|(?:application|text)\/(?:javascript|ecmascript|wasm|java-archive|x-sh|x-msdownload)/i;

function issue(code: ShotSkillImportErrorCode, path: string, message: string): never {
  throw new ShotSkillImportValidationError({ code, path, message });
}

function jsonPath(parts: readonly PropertyKey[]): string {
  return parts.reduce<string>((path, part) => (
    typeof part === 'number'
      ? `${path}[${part}]`
      : /^[A-Za-z_$][\w$]*$/.test(String(part))
        ? `${path}.${String(part)}`
        : `${path}[${JSON.stringify(String(part))}]`
  ), '$');
}

function assertDepth(value: unknown, depth = 0, path: PropertyKey[] = []): void {
  if (depth > SHOT_SKILL_JSON_MAX_DEPTH) {
    issue('SKILL_IMPORT_MAX_DEPTH', jsonPath(path), 'JSON exceeds the maximum nesting depth of 20.');
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      path.push(index);
      assertDepth(value[index], depth + 1, path);
      path.pop();
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      path.push(key);
      assertDepth(child, depth + 1, path);
      path.pop();
    }
  }
}

function assertSafePayload(value: unknown, path: PropertyKey[] = []): void {
  if (typeof value === 'string') {
    if (value.length > 4_000) {
      issue('SKILL_IMPORT_SCHEMA_INVALID', jsonPath(path), 'Text fields cannot exceed 4000 characters.');
    }
    if (urlLikeValue.test(value)) {
      issue('SKILL_IMPORT_DANGEROUS_VALUE', jsonPath(path), 'URL-like values are not allowed in Shot Skill imports.');
    }
    if (scriptLikeValue.test(value)) {
      issue('SKILL_IMPORT_DANGEROUS_VALUE', jsonPath(path), 'Script payloads are not allowed in Shot Skill imports.');
    }
    if (executableValue.test(value)) {
      issue('SKILL_IMPORT_DANGEROUS_VALUE', jsonPath(path), 'Executable payloads and file references are not allowed in Shot Skill imports.');
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      path.push(index);
      assertSafePayload(value[index], path);
      path.pop();
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    path.push(key);
    if (dangerousKeyNames[normalizedKey] || /(?:systemprompt|scripts?|executables?|remotedependenc(?:y|ies)|dependenc(?:y|ies)|urls?|uris?|href|endpoints?|webhooks?|commands?|shell|binar(?:y|ies)|packages?|plugins?|proto|prototype|constructor)$/.test(normalizedKey)) {
      issue('SKILL_IMPORT_DANGEROUS_FIELD', jsonPath(path), 'Executable, script, URL, and remote dependency fields are not allowed.');
    }
    assertSafePayload(child, path);
    path.pop();
  }
}

function assertSchema(value: unknown): ShotSkillCard {
  const parsed = shotSkillEditorFormSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  if (!first) {
    issue('SKILL_IMPORT_SCHEMA_INVALID', '$', 'Shot Skill definition does not match the required schema.');
  }
  if (first.code === 'unrecognized_keys') {
    const unknownKey = [...first.keys].sort()[0];
    issue(
      'SKILL_IMPORT_SCHEMA_UNKNOWN_FIELD',
      jsonPath(unknownKey === undefined ? first.path : [...first.path, unknownKey]),
      'Unknown fields are not allowed in Shot Skill imports.',
    );
  }
  issue(
    'SKILL_IMPORT_SCHEMA_INVALID',
    jsonPath(first.path),
    first.message,
  );
}

export function isShotSkillImportValidationError(error: unknown): error is ShotSkillImportValidationError {
  return error instanceof ShotSkillImportValidationError;
}

export function exportShotSkillDefinition(definition: ShotSkillCard): {
  fileName: string;
  content: string;
  fileHash: string;
} {
  const normalized = shotSkillCardSchema.parse(definition);
  const content = `${stableStringify(normalized)}\n`;
  return {
    fileName: `${normalized.id}-${normalized.version}.shot-skill.json`,
    content,
    fileHash: createHash('sha256').update(content).digest('hex'),
  };
}

export function validateShotSkillImportFileBoundary(input: {
  fileName: string;
  contentType: string;
  byteLength: number;
}): void {
  if (!input.fileName.endsWith('.shot-skill.json')) {
    issue('SKILL_IMPORT_INVALID_EXTENSION', '$file.name', 'Import files must use the exact lowercase .shot-skill.json extension.');
  }
  if (input.contentType !== SHOT_SKILL_JSON_MIME) {
    issue('SKILL_IMPORT_INVALID_MIME', '$file.type', `Import files must use the exact ${SHOT_SKILL_JSON_MIME} MIME type.`);
  }
  if (input.byteLength === 0 || input.byteLength > SHOT_SKILL_JSON_MAX_BYTES) {
    issue('SKILL_IMPORT_INVALID_SIZE', '$file.size', 'Import files must contain 1 to 262144 bytes.');
  }
}

export function previewShotSkillImport(input: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): ShotSkillImportPreview {
  validateShotSkillImportFileBoundary({
    fileName: input.fileName,
    contentType: input.contentType,
    byteLength: input.bytes.byteLength,
  });

  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch {
    issue('SKILL_IMPORT_INVALID_UTF8', '$file', 'Import files must contain valid UTF-8.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    issue('SKILL_IMPORT_INVALID_JSON', '$', 'Shot Skill import is not valid JSON.');
  }
  assertDepth(parsed);
  assertSafePayload(parsed);
  const definition = assertSchema(parsed);
  return {
    definition,
    bytes: input.bytes.byteLength,
    fileHash: createHash('sha256').update(input.bytes).digest('hex'),
    extensions: Object.keys(definition.extensions).sort(),
  };
}
