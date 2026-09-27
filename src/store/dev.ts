/**
 * Test and debug helpers that change the state directly, outside the rules.
 * Used by the browser tests through window.__kogyo.dev(); never by the game.
 */
import type { GameState } from '../core';
import { dayIndex } from '../core/calendar';
import { forceEvent } from '../core/events';
import { createFacility } from '../core/facilities';
import { completeResearch } from '../core/research';
import { baseSalary, randomName } from '../core/staff';
import type { DevPatch } from './protocol';

export function applyDev(s: GameState, p: DevPatch) {
  for (const f of p.features ?? []) s.features[f] = true;
  if (p.cash !== undefined) s.cash = p.cash;
  for (const t of p.research ?? []) completeResearch(s, t);
  for (const b of p.build ?? []) {
    for (let i = 0; i < b.count; i++) createFacility(s, b.type, { recipe: b.recipe });
    s.staffRev++;
  }
  for (const e of p.employees ?? []) {
    for (let i = 0; i < (e.count ?? 1); i++) {
      s.employees.push({
        id: s.nextId++,
        name: randomName(s),
        role: e.role,
        skill: e.skill,
        exp: 0,
        specialty: e.role === 'manager' || e.role === 'director' ? 'management' : e.role === 'researcher' ? 'research' : 'extraction',
        salary: baseSalary(e.role, e.skill),
        assignedTo: null,
        hiredDay: dayIndex(s.tick),
      });
    }
    s.staffRev++;
  }
  for (const [item, q] of Object.entries(p.inventory ?? {})) s.inventory[item] = q;
  if (p.event) forceEvent(s, p.event);
}
