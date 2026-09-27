import { DATA, type Facility } from '../data';
import type { GameState, Stage } from './types';

type Cat = 'extraction' | 'processing' | 'manufacturing';

/** research effects folded into multipliers */
export interface Mods {
  rate: Record<Stage, Record<Cat, number>>;
  rateByFacility: Record<string, number>;
  power: number;
  powerByFacility: Record<string, number>;
  inputs: number;
  logistics: number;
  logisticsCost: number;
  management: number;
  candidates: number;
  skillGrowth: number;
  machinesPerLevel: number;
  fuel: number;
  managerBonus: number;
  loanLimit: number;
}

const cache = new WeakMap<GameState, { key: number; mods: Mods }>();

function blank(): Mods {
  const cats = (): Record<Cat, number> => ({ extraction: 1, processing: 1, manufacturing: 1 });
  return {
    rate: { manual: cats(), machine: cats(), auto: cats() },
    rateByFacility: {},
    power: 1,
    powerByFacility: {},
    inputs: 1,
    logistics: 1,
    logisticsCost: 1,
    management: 1,
    candidates: 0,
    skillGrowth: 1,
    machinesPerLevel: 0,
    fuel: 1,
    managerBonus: 0,
    loanLimit: 1,
  };
}

export function computeMods(done: readonly string[]): Mods {
  const m = blank();
  for (const id of done) {
    const tech = DATA.tech[id];
    if (!tech) continue;
    for (const e of tech.effects) {
      switch (e.type) {
        case 'rate': {
          const stages: Stage[] = e.stage === 'all' ? ['manual', 'machine', 'auto'] : [e.stage];
          if (e.facility) {
            m.rateByFacility[e.facility] = (m.rateByFacility[e.facility] ?? 1) * (1 + e.value);
            break;
          }
          const cats: Cat[] = e.category === 'all' ? ['extraction', 'processing', 'manufacturing'] : [e.category];
          for (const st of stages) for (const c of cats) m.rate[st][c] *= 1 + e.value;
          break;
        }
        case 'power':
          if (e.facility) m.powerByFacility[e.facility] = (m.powerByFacility[e.facility] ?? 1) * (1 + e.value);
          else m.power *= 1 + e.value;
          break;
        case 'inputs':
          m.inputs *= 1 + e.value;
          break;
        case 'logistics':
          m.logistics *= 1 + e.value;
          break;
        case 'logisticsCost':
          m.logisticsCost *= 1 + e.value;
          break;
        case 'management':
          m.management += e.value;
          break;
        case 'candidates':
          m.candidates += e.value;
          break;
        case 'skillGrowth':
          m.skillGrowth *= 1 + e.value;
          break;
        case 'machinesPerLevel':
          m.machinesPerLevel += e.value;
          break;
        case 'fuel':
          m.fuel *= 1 + e.value;
          break;
        case 'managerBonus':
          m.managerBonus += e.value;
          break;
        case 'loanLimit':
          m.loanLimit += e.value;
          break;
        case 'unlock':
        case 'feature':
          break;
      }
    }
  }
  return m;
}

export function mods(state: GameState): Mods {
  const key = state.research.done.length;
  const hit = cache.get(state);
  if (hit && hit.key === key) return hit.mods;
  const m = computeMods(state.research.done);
  cache.set(state, { key, mods: m });
  return m;
}

export function rateMod(state: GameState, def: Facility, stage: Stage): number {
  if (def.category === 'infrastructure') return 1;
  const m = mods(state);
  return m.rate[stage][def.category] * (m.rateByFacility[def.id] ?? 1);
}

export function powerMod(state: GameState, def: Facility): number {
  const m = mods(state);
  return m.power * (m.powerByFacility[def.id] ?? 1);
}
