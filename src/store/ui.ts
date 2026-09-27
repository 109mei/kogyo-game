/**
 * Navigation, bottom sheets and toasts. Pure UI state; nothing here is saved
 * with the game.
 */
import { create } from 'zustand';
import type { Link, Solution } from '../core';

export type Tab = 'home' | 'production' | 'assets' | 'market' | 'more';

export type Route =
  | { screen: 'facility'; id: number }
  | { screen: 'build'; id?: string }
  | { screen: 'item'; id: string }
  | { screen: 'marketItem'; id: string }
  | { screen: 'staff' }
  | { screen: 'research'; id?: string }
  | { screen: 'power' }
  | { screen: 'logistics' }
  | { screen: 'finance' }
  | { screen: 'company' }
  | { screen: 'encyclopedia' }
  | { screen: 'settings' }
  | { screen: 'notices' }
  | { screen: 'world' };

export interface Toast {
  id: number;
  text: string;
  level: 'good' | 'bad' | 'info';
}

export type Sheet =
  | { kind: 'solutions'; title: string; detail: string; icon: string; solutions: Solution[] }
  | { kind: 'employee'; id: number }
  | { kind: 'assign'; facilityId: number }
  | { kind: 'build'; facility: string }
  | { kind: 'goal' }
  | { kind: 'confirm'; title: string; body: string; ok: string; onOk: () => void };

interface UIStore {
  tab: Tab;
  stack: Route[];
  sheet: Sheet | null;
  toasts: Toast[];
  setTab(t: Tab): void;
  push(r: Route): void;
  /** the header's back button: goes through browser history so both stay in step */
  goBack(): void;
  /** pops one screen (called from popstate) */
  back(): void;
  openSheet(s: Sheet): void;
  closeSheet(): void;
}

let toastId = 1;

export const useUI = create<UIStore>((set, get) => ({
  tab: 'home',
  stack: [],
  sheet: null,
  toasts: [],
  setTab(t) {
    const depth = get().stack.length;
    set({ tab: t, stack: [], sheet: null });
    if (depth > 0) history.go?.(-depth);
    window.scrollTo?.(0, 0);
  },
  push(r) {
    set({ stack: [...get().stack, r], sheet: null });
    history.pushState?.({ depth: get().stack.length }, '');
    window.scrollTo?.(0, 0);
  },
  goBack() {
    if (get().stack.length) history.back();
  },
  back() {
    const st = get().stack;
    if (st.length) set({ stack: st.slice(0, -1), sheet: null });
  },
  openSheet(s) {
    set({ sheet: s });
  },
  closeSheet() {
    set({ sheet: null });
  },
}));

export function toast(text: string, level: Toast['level'] = 'info') {
  const t = { id: toastId++, text, level };
  useUI.setState((s) => ({ toasts: [...s.toasts.slice(-2), t] }));
  setTimeout(() => useUI.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), level === 'bad' ? 3600 : 2400);
}

/** follow a link from the rule engine (notices, problems) */
export function openLink(link: Link | null | undefined) {
  if (!link) return;
  const ui = useUI.getState();
  switch (link.screen) {
    case 'facility':
      ui.push({ screen: 'facility', id: link.id });
      return;
    case 'item':
      ui.push({ screen: 'item', id: link.id });
      return;
    case 'market':
      // push onto the current tab: switching tabs rewinds history asynchronously
      if (link.id) ui.push({ screen: 'marketItem', id: link.id });
      else ui.setTab('market');
      return;
    case 'research':
      ui.push({ screen: 'research', id: link.id });
      return;
    case 'build':
      ui.push({ screen: 'build', id: link.id });
      return;
    case 'production':
      ui.setTab('production');
      return;
    case 'assets':
      ui.setTab('assets');
      return;
    default:
      ui.push({ screen: link.screen });
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const ui = useUI.getState();
    if (ui.sheet) {
      // the back button closes the sheet but keeps the screen underneath
      ui.closeSheet();
      history.pushState({ depth: ui.stack.length }, '');
      return;
    }
    ui.back();
  });
}
