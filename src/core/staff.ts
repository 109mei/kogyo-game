import { DATA, type RoleId } from '../data';
import { dayIndex } from './calendar';
import { mods } from './mods';
import { pick, pickWeighted, random } from './rng';
import type { Candidate, Employee, FacilityState, GameState, Specialty } from './types';
import { hasFeature, newId, notify } from './util';

const PRODUCTION_SPECIALTIES: Specialty[] = ['extraction', 'processing', 'manufacturing'];

export const SPECIALTY_NAME: Record<Specialty, string> = {
  extraction: '採取',
  processing: '加工',
  manufacturing: '製造',
  research: '研究',
  management: '管理',
};

export function randomName(s: GameState): string {
  return pick(s, DATA.names.surnames) + ' ' + pick(s, DATA.names.given);
}

function roleUnlocked(s: GameState, role: RoleId): boolean {
  const u = DATA.balance.staff.roles[role].unlock;
  return u === 'start' || hasFeature(s, u);
}

export function baseSalary(role: RoleId, skill: number): number {
  const st = DATA.balance.staff;
  return Math.round(st.roles[role].salary * (1 + (skill - 1) * st.skillSalaryStep));
}

export function makeCandidate(s: GameState, forceRole?: RoleId): Candidate {
  const st = DATA.balance.staff;
  const roles = (Object.keys(st.roles) as RoleId[]).filter((r) => roleUnlocked(s, r));
  const role = forceRole ?? pickWeighted(s, roles, roles.map((r) => st.roles[r].weight));
  const skill = pickWeighted(s, [1, 2, 3, 4, 5], st.candidateSkillWeights);
  const specialty: Specialty =
    role === 'researcher' ? 'research' : role === 'manager' ? 'management' : pick(s, PRODUCTION_SPECIALTIES);
  const salary = Math.round((baseSalary(role, skill) * (0.92 + 0.16 * random(s))) / 1000) * 1000;
  return {
    id: newId(s),
    name: randomName(s),
    role,
    skill,
    specialty,
    salary,
    expires: dayIndex(s.tick) + st.candidateLifeDays,
  };
}

export function candidatesPerWeek(s: GameState): number {
  const hq = DATA.balance.hq[s.hq.level - 1];
  return hq.candidates + mods(s).candidates;
}

/** weekly refresh: drop expired candidates and add new ones */
export function refreshCandidates(s: GameState, silent = false) {
  const d = dayIndex(s.tick);
  s.candidates = s.candidates.filter((c) => c.expires > d);
  const n = candidatesPerWeek(s);
  const fresh: Candidate[] = [];
  // make sure research can start: offer a researcher when there is a lab without one
  const needResearcher =
    s.facilities.some((f) => f.type === 'research_lab') && !s.employees.some((e) => e.role === 'researcher');
  for (let i = 0; i < n; i++) fresh.push(makeCandidate(s, i === 0 && needResearcher ? 'researcher' : undefined));
  s.candidates.push(...fresh);
  if (s.candidates.length > 24) s.candidates.splice(0, s.candidates.length - 24);
  // only a standout applicant is worth a notice; the staff menu shows the count
  const best = fresh.reduce<Candidate | null>((b, c) => (!b || c.skill > b.skill ? c : b), null);
  if (!silent && best && best.skill >= 4 && hasFeature(s, 'hire')) {
    notify(s, 'info', 'ppl_worker', `優秀な応募者が来ました（★${best.skill}）`, `${best.name}さん・${DATA.balance.staff.roles[best.role].name}`, { screen: 'staff' });
  }
}

const indexCache = new WeakMap<GameState, { rev: number; count: number; byFacility: Map<number, Employee[]> }>();

/** staff assigned to each facility (managers excluded), cached until staffRev changes */
function staffIndex(s: GameState): Map<number, Employee[]> {
  const hit = indexCache.get(s);
  if (hit && hit.rev === s.staffRev && hit.count === s.employees.length) return hit.byFacility;
  const byFacility = new Map<number, Employee[]>();
  for (const e of s.employees) {
    if (e.assignedTo === null || e.role === 'manager') continue;
    const list = byFacility.get(e.assignedTo);
    if (list) list.push(e);
    else byFacility.set(e.assignedTo, [e]);
  }
  indexCache.set(s, { rev: s.staffRev, count: s.employees.length, byFacility });
  return byFacility;
}

const EMPTY: Employee[] = [];

export function employeesAt(s: GameState, facilityId: number): Employee[] {
  return staffIndex(s).get(facilityId) ?? EMPTY;
}

/** which roles can work at a facility (not counting the manager slot) */
export function rolesFor(f: FacilityState): RoleId[] {
  if (f.type === 'research_lab') return ['researcher'];
  if (f.type === 'warehouse' || f.type === 'logistics_center') return [];
  return ['worker', 'engineer'];
}

/** how many staff a facility can take right now */
export function staffCapacity(_s: GameState, f: FacilityState): number {
  const def = DATA.facility[f.type];
  if (f.type === 'research_lab') return (def.researchers ?? 0) * f.level;
  if (def.generator) return f.stage === 'auto' ? 0 : f.machines * def.generator.operators;
  if (def.category === 'infrastructure') return 0;
  if (f.stage === 'manual') {
    if (!def.manualWorkers) return 0;
    return f.level === 0 ? DATA.balance.start.workyardWorkers : def.manualWorkers * f.level;
  }
  if (f.stage === 'machine') return f.machines * (def.machine?.operators ?? 0);
  return 0;
}

export function skillMult(skill: number): number {
  return DATA.balance.staff.skillMult[Math.max(1, Math.min(5, skill)) - 1];
}

/** productivity of one employee at a facility (manual work) */
export function workerPower(e: Employee, category: string): number {
  const st = DATA.balance.staff;
  let p = skillMult(e.skill);
  if (e.specialty === category) p *= 1 + st.specialtyBonus;
  if (e.role === 'engineer') p *= 1.1;
  return p;
}

export function monthlyPayroll(s: GameState): number {
  let t = 0;
  for (const e of s.employees) t += e.salary;
  return t;
}

/** daily experience and promotions to higher skill */
export function dailyStaff(s: GameState) {
  const st = DATA.balance.staff;
  const growth = mods(s).skillGrowth;
  for (const e of s.employees) {
    if (e.assignedTo === null) continue;
    if (e.skill >= 5) continue;
    e.exp += growth;
    if (e.exp >= st.expDaysPerStar * e.skill) {
      e.exp = 0;
      e.skill += 1;
      e.salary = Math.round(e.salary * (1 + st.skillSalaryStep));
      s.staffRev++;
      if (e.skill >= 4) {
        notify(s, 'good', 'ui_star', `${e.name}さんが熟練度★${e.skill}になりました`, '昇進させることもできます', { screen: 'staff' });
      }
    }
  }
}

export function idleEmployees(s: GameState): Employee[] {
  return s.employees.filter((e) => e.assignedTo === null);
}

