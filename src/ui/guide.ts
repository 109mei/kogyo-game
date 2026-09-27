/**
 * The first goals light up the next thing to press: the tab, then the row,
 * then the button. Each screen marks its controls with data-testid; this
 * picks the ones that lead to the current goal. Only while the first goals
 * are open, and it can be turned off in the settings.
 */
import { DATA } from '../data';
import type { GameState } from '../core';
import { defOf } from '../core/facilities';
import { employeesAt, staffCapacity } from '../core/staff';

/** goals up to this one get the lights */
const LAST_GUIDED = 'g_power';

function hirePath(s: GameState, role: 'worker' | 'researcher' = 'worker'): string[] {
  const idle = s.employees.filter((e) => e.assignedTo === null && (role === 'researcher' ? e.role === 'researcher' : e.role === 'worker' || e.role === 'engineer'));
  if (idle.length) return ['nav-more', 'menu-staff', 'tab-people', 'auto-assign'];
  return ['nav-more', 'menu-staff', 'tab-candidates', role === 'researcher' ? 'hire-researcher' : 'hire'];
}

function buildPath(s: GameState, type: string): string[] | null {
  const f = s.facilities.find((x) => x.type === type);
  if (!f) return ['nav-production', 'open-build', `build-${type}`, 'build-confirm'];
  if (f.building && f.building.kind === 'build') return null;
  if (employeesAt(s, f.id).length < Math.min(1, staffCapacity(s, f))) return hirePath(s, type === 'research_lab' ? 'researcher' : 'worker');
  return null;
}

/** test ids of the controls to light up, in the order they are pressed */
export function guideKeys(s: GameState): string[] {
  if (!s.settings.guide) return [];
  const last = DATA.goals.findIndex((g) => g.id === LAST_GUIDED);
  const idx = DATA.goals.findIndex((g) => !s.goals.done.includes(g.id));
  if (idx < 0 || idx > last) return [];
  const g = DATA.goals[idx];
  switch (g.id) {
    case 'g_gather': {
      const forest = s.facilities.find((f) => f.recipe === 'log' && f.stage === 'manual');
      return forest ? ['nav-production', `tap-${forest.id}`] : [];
    }
    case 'g_sell':
      return ['nav-market', 'market-log', 'sell-max', 'sell'];
    case 'g_hire':
    case 'g_team':
      return hirePath(s);
    case 'g_sawmill':
      return buildPath(s, 'sawmill') ?? [];
    case 'g_furniture':
      return buildPath(s, 'assembly_plant') ?? [];
    case 'g_lab':
      return buildPath(s, 'research_lab') ?? hirePath(s, 'researcher');
    case 'g_mech': {
      const next = !s.research.done.includes('p_tools') ? 'p_tools' : 'p_mech';
      if (s.research.current === next) return [];
      return ['nav-more', 'menu-research', `research-${next}`];
    }
    case 'g_machine': {
      // a hand-work facility that can take a machine (workyards need their first expansion)
      const f = s.facilities.find((x) => x.stage === 'manual' && defOf(x).machine && defOf(x).manualWorkers && x.level >= 1 && !x.building);
      if (f) return ['nav-production', `facility-${f.id}`, 'tab-production', 'buy-machine'];
      const w = s.facilities.find((x) => x.stage === 'manual' && defOf(x).machine && defOf(x).manualWorkers && !x.building);
      return w ? ['nav-production', `facility-${w.id}`, 'tab-production', 'upgrade-level'] : [];
    }
    case 'g_power':
      return ['nav-more', 'menu-power', 'contract-low'];
    default:
      return [];
  }
}

/**
 * Mark the control to press next (and clear the old mark). The path is in the
 * order things are pressed, so the furthest control that is on screen and
 * can be pressed is the next step: the tab from home, the row on the tab,
 * the button once the row is open.
 */
export function paintGuide(keys: string[], activeTab: string | null): boolean {
  if (typeof document === 'undefined') return false;
  for (const el of document.querySelectorAll('[data-guide]')) el.removeAttribute('data-guide');
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    // the tab we are already on is not the next step
    if (activeTab && k === `nav-${activeTab}`) continue;
    const el = [...document.querySelectorAll<HTMLElement>(`[data-testid="${k}"]`)].find((x) => x.offsetParent !== null && !(x as HTMLButtonElement).disabled);
    if (!el) continue;
    el.setAttribute('data-guide', '');
    return true;
  }
  return false;
}
