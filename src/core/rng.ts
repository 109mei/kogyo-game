/**
 * Seeded PRNG (sfc32). The 128-bit state lives inside GameState so a save
 * continues the exact same random sequence after loading.
 */
export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  // splitmix32 to spread a small seed over the whole state
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const st: RngState = [next(), next(), next(), next()];
  const tmp = { rng: st };
  for (let i = 0; i < 12; i++) random(tmp);
  return tmp.rng;
}

/** uniform [0, 1) */
export function random(holder: { rng: RngState }): number {
  const st = holder.rng;
  let [a, b, c, d] = st;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  st[0] = a >>> 0;
  st[1] = b >>> 0;
  st[2] = c >>> 0;
  st[3] = d >>> 0;
  return t / 4294967296;
}

export function randInt(holder: { rng: RngState }, lo: number, hi: number): number {
  return lo + Math.floor(random(holder) * (hi - lo + 1));
}

export function pick<T>(holder: { rng: RngState }, list: readonly T[]): T {
  return list[Math.floor(random(holder) * list.length)];
}

export function pickWeighted<T>(holder: { rng: RngState }, list: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let r = random(holder) * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r < 0) return list[i];
  }
  return list[list.length - 1];
}

/** standard normal via Box-Muller (uses two draws) */
export function normal(holder: { rng: RngState }): number {
  const u = Math.max(1e-12, random(holder));
  const v = random(holder);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
