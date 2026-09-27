import { DATA } from '../data';
import type { GameState } from './types';
import { unlocked } from './util';

/** a recipe can be used once both it and its facility are unlocked */
export function recipeUnlocked(s: GameState, recipeId: string): boolean {
  const r = DATA.recipe[recipeId];
  return unlocked(s, r.unlock) && unlocked(s, DATA.facility[r.facility].unlock);
}

export function facilityUnlocked(s: GameState, facilityId: string): boolean {
  return unlocked(s, DATA.facility[facilityId].unlock);
}

/** items the player has discovered: made or used by an unlocked recipe, or owned */
export function visibleItems(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const r of DATA.recipes) {
    if (!recipeUnlocked(s, r.id)) continue;
    out.add(r.id);
    for (const inp of Object.keys(r.inputs)) out.add(inp);
  }
  for (const [item, q] of Object.entries(s.inventory)) if (q > 0) out.add(item);
  for (const f of s.facilities) if (f.fuel) out.add(f.fuel);
  return out;
}
