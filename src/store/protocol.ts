/**
 * Messages between the page and the simulation worker.
 */
import type { Command, CommandResult, GameState } from '../core';
import type { RoleId } from '../data';
import type { OfflineReport } from '../save/offline';
import type { Snapshot } from './snapshot';

export type Init =
  | { kind: 'load'; text: string }
  | { kind: 'import'; text: string }
  | { kind: 'new'; name: string; seed?: number };

/** test and debug helpers: they change the state directly, outside the rules */
export interface DevPatch {
  features?: string[];
  cash?: number;
  research?: string[];
  /** facilities that appear finished at level 1 */
  build?: { type: string; count: number; recipe?: string }[];
  /** people who join unassigned */
  employees?: { role: RoleId; skill: number; count?: number }[];
  /** an event (events.json id) comes up now */
  event?: string;
  /** stock set to these amounts */
  inventory?: Record<string, number>;
}

export type ToWorker =
  | { t: 'init'; init: Init; now: number }
  | { t: 'cmd'; id: number; cmd: Command }
  | { t: 'advance'; id: number; ticks: number }
  | { t: 'full'; id: number }
  | { t: 'export'; id: number }
  | { t: 'save' }
  | { t: 'suspend'; now: number }
  | { t: 'resume'; id: number; now: number }
  | { t: 'freeze' }
  | { t: 'dev'; id: number; patch: DevPatch };

export type FromWorker =
  | { t: 'ready'; state: GameState; report: OfflineReport | null }
  | { t: 'fail'; message: string }
  | { t: 'snap'; snap: Snapshot }
  | { t: 'reply'; id: number; value: CommandResult | number | string | OfflineReport | null }
  | { t: 'save'; text: string; at: number; important: boolean }
  | { t: 'crash'; message: string };
