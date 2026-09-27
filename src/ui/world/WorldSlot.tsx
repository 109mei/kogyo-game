/**
 * Where the 3D estate goes. three.js loads only when the setting is on and
 * the slot is on screen for the first time.
 */
import { lazy, Suspense } from 'react';
import { useGame } from '../../store/game';

const WorldView = lazy(() => import('./WorldView'));

export function WorldSlot({ tall = false }: { tall?: boolean }) {
  const on = useGame((s) => s.settings.world3d, [], 1);
  if (!on) return null;
  return (
    <Suspense fallback={<div className={`world${tall ? ' tall' : ''}`} />}>
      <WorldView tall={tall} />
    </Suspense>
  );
}
