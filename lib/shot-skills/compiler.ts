import { createHash } from 'node:crypto';
import {
  shotSkillCardSchema,
  shotSkillContextSchema,
  type CompiledShotRecipe,
  type ShotSkillCard,
} from './schema';

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableNormalize(entry)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

export function hashStable(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** Hashes only the executable Card contract. Extensions are portable metadata. */
export function hashShotSkillDefinition(input: unknown): string {
  const { extensions: _extensions, ...executableDefinition } = shotSkillCardSchema.parse(input);
  return hashStable(executableDefinition);
}

function formatSeconds(ratio: number, durationSeconds: number): string {
  const seconds = ratio * durationSeconds;
  return Number.isInteger(seconds) ? `${seconds}` : seconds.toFixed(1).replace(/\.0$/, '');
}

function compileTimeline(skill: ShotSkillCard, durationSeconds: number): string[] {
  return skill.timeline.map((beat) => {
    const from = formatSeconds(beat.fromRatio, durationSeconds);
    const to = formatSeconds(beat.toRatio, durationSeconds);
    return `${from}-${to}s: ${beat.action}`;
  });
}

function compileCamera(skill: ShotSkillCard): string {
  return [
    `Shot size: ${skill.camera.shotSize}`,
    `Composition: ${skill.camera.composition}`,
    `Movement: ${skill.camera.movement}`,
    `Focus: ${skill.camera.focus}`,
    `Lighting: ${skill.camera.lighting}`,
  ].join('\n');
}

function compilePrompt(recipe: CompiledShotRecipe['providerNeutralRecipe']): string {
  return [
    `Create one ${recipe.output.durationSeconds}-second ${recipe.output.ratio} product shot at ${recipe.output.resolution}.`,
    '',
    'Goal:',
    recipe.goal,
    '',
    'Shot direction:',
    recipe.shotDirection,
    '',
    'Timeline:',
    ...recipe.timeline,
    '',
    'Camera:',
    recipe.camera,
    '',
    'Target platform:',
    recipe.targetPlatform,
    '',
    'Brand voice:',
    recipe.brandVoice,
    '',
    'Approved product facts:',
    recipe.approvedProductFacts,
    '',
    'Must show:',
    ...recipe.mustShowElements.map((item) => `- ${item}`),
    '',
    'Preserve exactly:',
    ...recipe.preserveExactly.map((item) => `- ${item}`),
    '',
    'Never show:',
    ...recipe.neverShow.map((item) => `- ${item}`),
    '',
    'Output:',
    `One continuous shot, ${recipe.output.ratio}, ${recipe.output.durationSeconds} seconds.`,
  ].join('\n');
}

export function compileShotRecipe(input: unknown, skillInput: unknown): CompiledShotRecipe {
  const context = shotSkillContextSchema.parse(input);
  const skill = shotSkillCardSchema.parse(skillInput);
  if (!skill.provider.durationSeconds.includes(context.durationSeconds)) {
    throw new Error(`Provider output does not allow ${context.durationSeconds} seconds.`);
  }
  const skillHash = hashShotSkillDefinition(skill);
  const timeline = compileTimeline(skill, context.durationSeconds);
  const providerNeutralRecipe = {
    goal: skill.goal,
    shotDirection: context.shotDirection,
    timeline,
    camera: compileCamera(skill),
    targetPlatform: context.targetPlatform,
    brandVoice: context.brandVoice,
    approvedProductFacts: context.sellingPoints,
    mustShowElements: context.mustShowElements,
    preserveExactly: [
      ...context.immutableElements,
      ...skill.invariants.map((rule) => rule.description),
    ],
    neverShow: [
      ...context.forbiddenElements,
      ...skill.forbidden.map((rule) => rule.description),
    ],
    output: {
      durationSeconds: context.durationSeconds,
      ratio: skill.provider.ratio,
      resolution: skill.provider.resolution,
    },
  } satisfies CompiledShotRecipe['providerNeutralRecipe'];
  const prompt = compilePrompt(providerNeutralRecipe);
  const compilationTrace = [
    { field: 'goal', source: `skill:${skill.id}@${skill.version}`, value: providerNeutralRecipe.goal },
    { field: 'shotDirection', source: 'creative-spec.shotDirection', value: providerNeutralRecipe.shotDirection },
    { field: 'timeline', source: `skill:${skill.id}@${skill.version}`, value: timeline.join(' | ') },
    { field: 'camera', source: `skill:${skill.id}@${skill.version}`, value: providerNeutralRecipe.camera },
    { field: 'targetPlatform', source: 'campaign.targetPlatform', value: providerNeutralRecipe.targetPlatform },
    { field: 'brandVoice', source: 'brand-kit.brandVoice', value: providerNeutralRecipe.brandVoice },
    { field: 'approvedProductFacts', source: 'product-brief.sellingPoints', value: context.sellingPoints },
    { field: 'mustShowElements', source: 'brand-kit.requiredElements', value: providerNeutralRecipe.mustShowElements.join(' | ') || 'none' },
    { field: 'preserveExactly', source: 'product-brief.immutableElements+skill.invariants', value: providerNeutralRecipe.preserveExactly.join(' | ') },
    { field: 'neverShow', source: 'product-brief.forbiddenElements+skill.forbidden', value: providerNeutralRecipe.neverShow.join(' | ') },
    { field: 'output', source: 'skill.provider+product-brief.duration', value: stableStringify(providerNeutralRecipe.output) },
  ];
  const recipeHash = hashStable({ skillHash, providerNeutralRecipe, prompt, compilationTrace });

  return {
    skill: { id: skill.id, version: skill.version, hash: skillHash },
    providerNeutralRecipe,
    prompt,
    qualityChecks: skill.qualityChecks,
    compilationTrace,
    recipeHash,
  };
}
