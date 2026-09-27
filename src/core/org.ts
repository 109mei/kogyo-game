/**
 * Who runs a facility: the player, a factory manager, a division head, or a
 * subsidiary. Small lookups shared by production, automation and management
 * (kept apart from divisions.ts so these modules do not import each other).
 */
import { DATA } from '../data';
import type { Division, Employee, FacilityState, GameState } from './types';

/** the division that runs this facility: only once it has a head */
export function divisionFor(s: GameState, f: FacilityState): Division | null {
  const d = s.divisions[f.type];
  return d && d.headId !== null ? d : null;
}

export function headOf(s: GameState, type: string): Employee | null {
  const d = s.divisions[type];
  if (!d || d.headId === null) return null;
  return s.employees.find((e) => e.id === d.headId) ?? null;
}

/** true when a subsidiary runs the facility: the player no longer steers it one by one */
export function inSubsidiary(s: GameState, f: FacilityState): boolean {
  return !!s.divisions[f.type]?.sub;
}

/** output bonus from the division head (1 = none) */
export function divisionBonus(s: GameState, f: FacilityState): number {
  if (!divisionFor(s, f)) return 1;
  const h = headOf(s, f.type);
  return h ? 1 + DATA.balance.divisions.headBonusPerStar * h.skill : 1;
}

/** ids of facilities that belong to subsidiaries (their staff do not load the head office) */
export function subsidiaryFacilityIds(s: GameState): Set<number> {
  const out = new Set<number>();
  for (const d of Object.values(s.divisions)) {
    if (!d.sub) continue;
    for (const f of s.facilities) if (f.type === d.type) out.add(f.id);
  }
  return out;
}

export function divisionName(type: string): string {
  return `${DATA.facility[type].short}部門`;
}
