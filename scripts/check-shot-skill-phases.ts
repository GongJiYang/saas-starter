import assert from 'node:assert/strict';
import {
  assertShotSkillPhaseCanStart,
  createShotSkillProductizationPlan,
  shotSkillProductizationPhases,
  shotSkillStrictDependencies,
  type ShotSkillProductizationPhaseId,
} from '../lib/shot-skills/productization-phases';

assert.deepEqual(shotSkillProductizationPhases.map((phase) => phase.id), ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']);
assert.equal(shotSkillProductizationPhases.find((phase) => phase.id === 'P2')?.execution, 'parallel');
assert.equal(shotSkillProductizationPhases.find((phase) => phase.id === 'P2')?.workstreams.length, 4);
assert.equal(shotSkillProductizationPhases.find((phase) => phase.id === 'P3')?.execution, 'parallel');
assert.equal(shotSkillProductizationPhases.find((phase) => phase.id === 'P3')?.workstreams.length, 4);
assert.equal(shotSkillStrictDependencies.length, 8);
assert.deepEqual(createShotSkillProductizationPlan('P4').map((phase) => phase.id), ['P0', 'P1', 'P2', 'P3', 'P4']);
assert.throws(() => assertShotSkillPhaseCanStart('P2', new Set<ShotSkillProductizationPhaseId>(['P0'])), /P1/);
assert.throws(() => assertShotSkillPhaseCanStart('P4', new Set<ShotSkillProductizationPhaseId>(['P0', 'P1', 'P2'])), /P3/);
assert.doesNotThrow(() => assertShotSkillPhaseCanStart('P5', new Set<ShotSkillProductizationPhaseId>(['P0', 'P1', 'P2', 'P3', 'P4'])));

console.info('Shot Skill productization phase boundaries passed.');
