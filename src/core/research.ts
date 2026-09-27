import { DATA } from '../data';
import { employeesAt, skillMult } from './staff';
import type { GameState } from './types';
import { addHistory, hasFeature, notify, techDone } from './util';

export function techAvailable(s: GameState, id: string): boolean {
  const t = DATA.tech[id];
  if (!t || techDone(s, id)) return false;
  return t.requires.every((r) => techDone(s, r));
}

export function labCapacity(s: GameState): number {
  let cap = 0;
  for (const f of s.facilities) if (f.type === 'research_lab' && !(f.building && f.building.kind === 'build')) cap += (DATA.facility.research_lab.researchers ?? 0) * f.level;
  return cap;
}

export function researchPerDay(s: GameState): number {
  let rp = 0;
  for (const f of s.facilities) {
    if (f.type !== 'research_lab' || (f.building && f.building.kind === 'build')) continue;
    const cap = (DATA.facility.research_lab.researchers ?? 0) * f.level;
    const staff = employeesAt(s, f.id).filter((e) => e.role === 'researcher').slice(0, cap);
    for (const e of staff) rp += skillMult(e.skill) * DATA.balance.research.rpPerResearcher;
  }
  return rp;
}

export function completeResearch(s: GameState, id: string) {
  if (techDone(s, id)) return;
  const t = DATA.tech[id];
  s.research.done.push(id);
  delete s.research.saved[id];
  for (const e of t.effects) if (e.type === 'feature') s.features[e.feature] = true;
  if (s.research.current === id) {
    s.research.current = null;
    s.research.progress = 0;
  }
  const u = DATA.unlockedBy[id];
  const names = [
    ...(u?.facilities ?? []).map((x) => DATA.facility[x].name),
    ...(u?.recipes ?? []).filter((x) => !(u?.facilities ?? []).includes(DATA.recipe[x].facility)).map((x) => DATA.item[x].name),
  ];
  notify(s, 'good', 'ev_tech', `研究完了：${t.name}`, names.length ? `解放：${names.slice(0, 6).join('、')}${names.length > 6 ? ' ほか' : ''}` : t.desc, {
    screen: 'research',
    id,
  });
  addHistory(s, 'ev_tech', `研究「${t.name}」を完成`);
}

export function tickResearch(s: GameState, dt: number) {
  const rp = researchPerDay(s);
  s.research.rpPerDay = rp;
  if (!s.research.current || rp <= 0 || !hasFeature(s, 'research')) return;
  s.research.progress += rp * dt;
  const t = DATA.tech[s.research.current];
  if (s.research.progress >= t.cost) completeResearch(s, t.id);
}
