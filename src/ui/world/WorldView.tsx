/**
 * The 3D estate on the home screen. Lazy-loaded so three.js never slows the
 * first paint; it reads a small description of the game twice a second and
 * draws at up to 30 fps only while visible. Tapping a building opens it.
 */
import { useEffect, useRef, useState } from 'react';
import { DATA } from '../../data';
import type { GameState, Stage } from '../../core';
import { useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { facilityStatus } from '../selectors';
import { WorldScene, type PlotDesc, type WorldDesc } from './scene';

const STAGE_RANK: Record<Stage, number> = { manual: 0, machine: 1, auto: 2 };

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function prefersReduced(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function describe(s: GameState): WorldDesc & { name: string; built: number } {
  const byType = new Map<string, PlotDesc & { first: number; building: number; utilSum: number }>();
  for (const f of s.facilities) {
    if (f.type === 'headquarters') continue;
    let p = byType.get(f.type);
    if (!p) {
      p = {
        type: f.type,
        category: DATA.facility[f.type].category,
        fid: f.id,
        count: 0,
        level: -1,
        stage: 'manual',
        util: 0,
        red: false,
        constructing: false,
        crane: false,
        first: f.id,
        building: 0,
        utilSum: 0,
      };
      byType.set(f.type, p);
    }
    p.count++;
    p.first = Math.min(p.first, f.id);
    if (f.level > p.level) {
      p.level = f.level;
      p.fid = f.id;
    }
    if (STAGE_RANK[f.stage] > STAGE_RANK[p.stage]) p.stage = f.stage;
    p.utilSum += f.util;
    if (f.building) {
      p.building++;
      p.crane = true;
    }
    if (!p.red && facilityStatus(s, f).tone === 'red') p.red = true;
  }
  const plots = [...byType.values()]
    .sort((a, b) => a.first - b.first)
    .map((p) => ({ ...p, util: p.utilSum / p.count, constructing: p.building === p.count && s.facilities.some((f) => f.type === p.type && f.building?.kind === 'build') }));
  const theme = s.settings.theme;
  return {
    plots,
    hqLevel: s.hq.level,
    hqBuilding: !!s.hq.building,
    trucks: s.logistics.trucks,
    rail: s.logistics.rail,
    paused: s.paused,
    speed: s.speed,
    night: theme === 'dark' || (theme === 'auto' && prefersDark()),
    reduced: prefersReduced(),
    name: s.companyName,
    built: s.facilities.filter((f) => !(f.building && f.building.kind === 'build')).length,
  };
}

export default function WorldView({ tall = false }: { tall?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const [failed, setFailed] = useState(false);
  const desc = useGame(describe, [], 2);
  const drag = useRef<{ x: number; y: number; moved: number; id: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    let scene: WorldScene;
    try {
      scene = new WorldScene(cv);
    } catch {
      setFailed(true);
      return;
    }
    sceneRef.current = scene;
    const size = () => {
      const r = el.getBoundingClientRect();
      scene.setSize(r.width, r.height);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    io.observe(el);
    const lost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    cv.addEventListener('webglcontextlost', lost);
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      if (now - last < 1000 / 30 - 2) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      scene.frame(dt);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      cv.removeEventListener('webglcontextlost', lost);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(desc);
  }, [desc]);

  if (failed) return null;

  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (Math.abs(dx) > Math.abs(dy)) sceneRef.current?.rotate(-dx * 0.008);
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved > 8 || !sceneRef.current || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    const hit = sceneRef.current.pick(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (!hit) return;
    if ('hq' in hit) useUI.getState().push({ screen: 'company' });
    else useUI.getState().push({ screen: 'facility', id: hit.fid });
  };

  return (
    <div className={`world${tall ? ' tall' : ''}`} ref={wrap} style={{ touchAction: 'pan-y' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => (drag.current = null)} data-testid="world">
      <canvas ref={canvas} role="img" aria-label={`${desc.name}の工業地帯（施設${desc.built}）。建物をタップすると開きます`} />
      <div className="world-caption">
        {desc.name}・施設{desc.built}
        {desc.paused ? '・一時停止中' : ''}
      </div>
    </div>
  );
}
