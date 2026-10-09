// 2D (x/z) collision world: axis-aligned boxes in a spatial hash.

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number; h?: number; tag?: string }

const CELL = 16;

export class Colliders {
  boxes: AABB[] = [];
  private grid = new Map<string, AABB[]>();

  clear() { this.boxes = []; this.grid.clear(); }

  add(b: AABB) {
    this.boxes.push(b);
    for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++)
      for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) {
        const k = cx + ',' + cz;
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(b);
      }
  }
  addBox(cx: number, cz: number, sx: number, sz: number, tag?: string, h = 3) {
    this.add({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, tag, h });
  }
  /** Rotated box approximated by its AABB (only used for 90° rotations). */
  addRotated(cx: number, cz: number, sx: number, sz: number, rot: number, tag?: string) {
    const q = Math.abs(Math.round(rot / (Math.PI / 2))) % 2 === 1;
    this.addBox(cx, cz, q ? sz : sx, q ? sx : sz, tag);
  }

  near(x: number, z: number, r: number) {
    const out = new Set<AABB>();
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const arr = this.grid.get(cx + ',' + cz);
        if (arr) for (const b of arr) out.add(b);
      }
    return out;
  }

  /** Push a circle out of all overlapping boxes. Returns the total push or null. */
  resolveCircle(x: number, z: number, r: number): { dx: number; dz: number } | null {
    let dx = 0, dz = 0, hit = false;
    for (const b of this.near(x, z, r)) {
      const px = x + dx, pz = z + dz;
      const nx = Math.max(b.minX, Math.min(px, b.maxX));
      const nz = Math.max(b.minZ, Math.min(pz, b.maxZ));
      const ddx = px - nx, ddz = pz - nz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        dx += (ddx / d) * (r - d);
        dz += (ddz / d) * (r - d);
      } else {
        // center inside box: push out along the shallowest axis
        const l = px - b.minX, rr = b.maxX - px, t = pz - b.minZ, bt = b.maxZ - pz;
        const m = Math.min(l, rr, t, bt);
        if (m === l) dx -= l + r; else if (m === rr) dx += rr + r; else if (m === t) dz -= t + r; else dz += bt + r;
      }
    }
    return hit ? { dx, dz } : null;
  }

  /** Distance along a 2D ray until it enters a box (for camera collision). */
  raycast(ox: number, oz: number, dx: number, dz: number, maxD: number, minH = 0): number {
    let best = maxD;
    const cx = ox + dx * maxD / 2, cz = oz + dz * maxD / 2;
    for (const b of this.near(cx, cz, maxD / 2 + 1)) {
      if ((b.h ?? 3) < minH) continue;
      let tmin = 0, tmax = maxD;
      for (const [o, d, lo, hi] of [[ox, dx, b.minX, b.maxX], [oz, dz, b.minZ, b.maxZ]] as const) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { tmin = Infinity; break; } continue; }
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) { tmin = Infinity; break; }
      }
      if (tmin < best && tmin > 0.01) best = tmin;
    }
    return best;
  }
}
