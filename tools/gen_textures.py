"""Generates the game's photoreal-style PBR surface textures (all original, procedural).

Every map is tileable (built from periodic FFT noise and periodic patterns).
Output per material in public/assets/tex/: <name>_albedo.jpg, <name>_normal.jpg,
<name>_orm.jpg (R = ambient occlusion, G = roughness, B = metalness).

Run:  python3 tools/gen_textures.py   (needs numpy + Pillow)
"""
import os, sys
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'tex')
os.makedirs(OUT, exist_ok=True)
N = 1024
rng = np.random.default_rng(7)


def fnoise(n=N, beta=2.0, lo=1.0, hi=None, seed=None):
    """Tileable fractal noise in [0,1] with a 1/f^beta spectrum between frequencies lo..hi."""
    r = np.random.default_rng(seed) if seed is not None else rng
    w = r.standard_normal((n, n))
    F = np.fft.fft2(w)
    fy = np.fft.fftfreq(n)[:, None] * n
    fx = np.fft.fftfreq(n)[None, :] * n
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    amp = 1.0 / f ** (beta / 2)
    amp[f < lo] = 0
    if hi is not None:
        amp[f > hi] = 0
    out = np.real(np.fft.ifft2(F * amp))
    out -= out.min(); out /= out.max() + 1e-9
    return out


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    # OpenGL convention (+Y up in tangent space)
    return np.stack([(-dx / l + 1) / 2, (dy / l + 1) / 2, (nz / l + 1) / 2], -1)


def blur(a, k=2):
    for _ in range(k):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    return a


def save(name, albedo, height, rough, ao=None, metal=None, nstrength=6.0, q=90):
    albedo = np.clip(albedo, 0, 1)
    Image.fromarray((albedo * 255).astype(np.uint8)).save(f'{OUT}/{name}_albedo.jpg', quality=q)
    nrm = normal_from_height(height, nstrength)
    Image.fromarray((np.clip(nrm, 0, 1) * 255).astype(np.uint8)).save(f'{OUT}/{name}_normal.jpg', quality=q)
    if ao is None:
        ao = np.clip(0.55 + 0.45 * (height - blur(height, 6)) * 4 + 0.45, 0, 1)
    if metal is None:
        metal = np.zeros_like(rough)
    orm = np.stack([np.clip(ao, 0, 1), np.clip(rough, 0, 1), np.clip(metal, 0, 1)], -1)
    Image.fromarray((orm * 255).astype(np.uint8)).save(f'{OUT}/{name}_orm.jpg', quality=q)
    print('wrote', name)


def col(hexs):
    return np.array([int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)])


def lerp3(a, b, t):
    return a[None, None, :] * (1 - t[..., None]) + b[None, None, :] * t[..., None]


# ---------------------------------------------------------------- asphalt (4 m tile)
def asphalt():
    base = fnoise(beta=1.2, lo=2)                      # broad mottling
    grain = fnoise(beta=0.2, lo=200)                   # aggregate speckle
    stones = (fnoise(beta=0.8, lo=60, hi=400) > 0.62).astype(float)
    wear = fnoise(beta=2.6, lo=1, hi=8)
    h = grain * 0.5 + stones * 0.6 + base * 0.2
    lum = 0.11 + base * 0.05 + grain * 0.07 + stones * 0.09 + wear * 0.05
    tint = lerp3(col('#2b2c2e'), col('#3b3a37'), wear)
    albedo = tint * (lum / 0.2)[..., None]
    rough = 0.82 + grain * 0.12 - wear * 0.1 - stones * 0.08
    save('asphalt', albedo, h, rough, nstrength=3.0)


# ---------------------------------------------------------------- sidewalk slabs (3 m tile, 2x2 slabs)
def sidewalk():
    y, x = np.mgrid[0:N, 0:N] / N
    slab = 2
    fx, fy = (x * slab) % 1, (y * slab) % 1
    joint = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy))
    groove = np.clip(joint / 0.006, 0, 1)
    idx = (np.floor(x * slab) + np.floor(y * slab) * 7) % 4
    shade = 0.92 + 0.06 * np.sin(idx * 2.3)
    n1 = fnoise(beta=1.6, lo=2)
    n2 = fnoise(beta=0.4, lo=150)
    stains = np.clip((fnoise(beta=2.2, lo=3, hi=40) - 0.62) * 4, 0, 1)
    h = groove * 0.8 + n2 * 0.15 + n1 * 0.05
    lum = (0.62 + n1 * 0.08 + n2 * 0.08) * shade * (0.55 + 0.45 * groove) * (1 - stains * 0.25)
    albedo = lerp3(col('#a7a39b'), col('#bab5ab'), n1) * (lum / 0.68)[..., None]
    rough = 0.86 + n2 * 0.1 - stains * 0.15
    ao = 0.65 + 0.35 * groove
    save('sidewalk', albedo, h, rough, ao=ao, nstrength=5)


# ---------------------------------------------------------------- cast concrete wall (4 m tile)
def concrete():
    y, x = np.mgrid[0:N, 0:N] / N
    n1 = fnoise(beta=1.8, lo=1)
    n2 = fnoise(beta=0.6, lo=120)
    pores = (fnoise(beta=0.3, lo=300) > 0.8).astype(float)
    # formwork panel lines every 1.2 m-ish and tie holes
    py = (y * 4) % 1
    seam = np.clip(np.minimum(py, 1 - py) / 0.004, 0, 1)
    px = (x * 3) % 1
    seam *= np.clip(np.minimum(px, 1 - px) / 0.003, 0, 1)
    hx, hy = (x * 6) % 1 - 0.5, (y * 8) % 1 - 0.5
    holes = 1 - np.clip((0.012 - np.sqrt(hx * hx + hy * hy)) / 0.004, 0, 1)
    streak = fnoise(beta=2.0, lo=4, hi=60)
    streak = blur(np.repeat(streak.mean(0, keepdims=True), N, 0) * 0.5 + streak * 0.5, 2)
    h = n2 * 0.3 + seam * 0.4 + holes * 0.4 - pores * 0.2
    lum = (0.55 + n1 * 0.12 + n2 * 0.06 - streak * 0.08) * (0.8 + 0.2 * seam) * (0.7 + 0.3 * holes)
    albedo = lerp3(col('#9b9891'), col('#b3aea4'), n1) * (lum / 0.6)[..., None]
    rough = 0.88 + n2 * 0.08
    save('concrete', albedo, h, rough, nstrength=4)


# ---------------------------------------------------------------- brick (2 m tile)
def brick():
    y, x = np.mgrid[0:N, 0:N] / N
    rows, cols = 28, 9  # ~7 cm courses, ~22 cm bricks
    ry = y * rows
    row = np.floor(ry)
    bx = x * cols + (row % 2) * 0.5
    fx, fy = bx % 1, ry % 1
    mortar = np.clip(np.minimum(np.minimum(fx, 1 - fx) / 0.035, np.minimum(fy, 1 - fy) / 0.12), 0, 1)
    bid = (np.floor(bx) % cols) * 31 + row * 17
    rnd = (np.sin(bid * 12.9898) * 43758.5453) % 1
    rnd2 = (np.sin(bid * 4.1414) * 24634.6345) % 1
    n2 = fnoise(beta=0.6, lo=150)
    n1 = fnoise(beta=1.8, lo=2)
    reds = lerp3(col('#7c3a2a'), col('#a5583e'), rnd)
    reds = reds * (0.85 + 0.3 * rnd2)[..., None] * (0.9 + 0.2 * n2)[..., None]
    mort = lerp3(col('#8e877c'), col('#a39d92'), n2)
    m = np.clip(mortar * 1.3, 0, 1)
    albedo = mort * (1 - m[..., None]) + reds * m[..., None]
    albedo *= (0.85 + 0.25 * n1)[..., None]
    h = m * 0.7 + n2 * 0.25 * m
    rough = 0.8 + 0.12 * n2
    ao = 0.6 + 0.4 * m
    save('brick', albedo, h, rough, ao=ao, nstrength=7)


# ---------------------------------------------------------------- stucco / plaster (4 m tile)
def plaster():
    n1 = fnoise(beta=1.9, lo=1)
    n2 = fnoise(beta=0.9, lo=60)
    n3 = fnoise(beta=0.3, lo=250)
    h = n2 * 0.6 + n3 * 0.4
    lum = 0.8 + n1 * 0.08 + n2 * 0.05
    albedo = lerp3(col('#d9d2c4'), col('#e8e2d6'), n1) * (lum / 0.84)[..., None]
    rough = 0.9 + n3 * 0.08
    save('plaster', albedo, h, rough, nstrength=3)


# ---------------------------------------------------------------- limestone cladding panels (3 m tile)
def stone():
    y, x = np.mgrid[0:N, 0:N] / N
    ry = y * 4; row = np.floor(ry)
    bx = x * 2 + (row % 2) * 0.5
    fx, fy = bx % 1, ry % 1
    joint = np.clip(np.minimum(np.minimum(fx, 1 - fx) / 0.006, np.minimum(fy, 1 - fy) / 0.012), 0, 1)
    pid = np.floor(bx) * 13 + row * 7
    rnd = (np.sin(pid * 12.9898) * 43758.5453) % 1
    n1 = fnoise(beta=1.5, lo=3)
    n2 = fnoise(beta=0.5, lo=200)
    fossils = (fnoise(beta=0.9, lo=80) > 0.75).astype(float) * 0.06
    albedo = lerp3(col('#cbbfa8'), col('#ddd3c0'), np.clip(rnd * 0.6 + n1 * 0.4, 0, 1))
    albedo *= (0.92 + 0.12 * n2 - fossils)[..., None] * (0.6 + 0.4 * joint)[..., None]
    h = joint * 0.6 + n2 * 0.2
    rough = 0.72 + n2 * 0.15
    save('stone', albedo, h, rough, ao=0.7 + 0.3 * joint, nstrength=4)


# ---------------------------------------------------------------- dark metal spandrel panels (3 m tile)
def metal():
    y, x = np.mgrid[0:N, 0:N] / N
    fx, fy = (x * 2) % 1, (y * 3) % 1
    joint = np.clip(np.minimum(np.minimum(fx, 1 - fx) / 0.004, np.minimum(fy, 1 - fy) / 0.006), 0, 1)
    n1 = fnoise(beta=1.6, lo=2)
    brushed = blur(np.repeat(fnoise(beta=0.5, lo=100)[:, :1], N, 1), 1)
    albedo = lerp3(col('#3a3d42'), col('#4a4e54'), n1) * (0.8 + 0.2 * joint)[..., None]
    h = joint * 0.5 + brushed * 0.05
    rough = 0.35 + brushed * 0.15 + n1 * 0.1
    save('metal', albedo, h, rough, metal=np.full_like(rough, 0.85), ao=0.7 + 0.3 * joint, nstrength=4)


# ---------------------------------------------------------------- roof gravel / membrane (6 m tile)
def roof():
    n1 = fnoise(beta=1.4, lo=2)
    g = fnoise(beta=0.2, lo=300)
    pebbles = (fnoise(beta=0.7, lo=120, hi=500) > 0.58).astype(float)
    h = pebbles * 0.6 + g * 0.4
    albedo = lerp3(col('#5d5b57'), col('#7b776f'), n1) * (0.8 + 0.3 * g + 0.15 * pebbles)[..., None]
    rough = 0.92 + g * 0.06
    save('roof', albedo, h, rough, nstrength=4)


# ---------------------------------------------------------------- grass (2 m tile)
def grass():
    n1 = fnoise(beta=1.6, lo=1)
    blades = fnoise(beta=0.15, lo=200)
    clump = fnoise(beta=1.0, lo=20, hi=200)
    dry = np.clip((fnoise(beta=2.2, lo=1, hi=10) - 0.55) * 3, 0, 1)
    green = lerp3(col('#2f4a1e'), col('#5b7a2f'), np.clip(blades * 0.7 + clump * 0.3, 0, 1))
    straw = lerp3(col('#6c6a3a'), col('#8d8452'), blades)
    albedo = green * (1 - dry[..., None] * 0.6) + straw * dry[..., None] * 0.6
    albedo *= (0.75 + 0.35 * n1)[..., None]
    h = blades * 0.7 + clump * 0.3
    save('grass', albedo, h, 0.95 - blades * 0.1, nstrength=5)


# ---------------------------------------------------------------- street decal atlas (4 x 512 tiles, RGBA)
def decals():
    T = 512
    out = np.zeros((T, T * 4, 4))
    hgt = np.zeros((T, T * 4))
    y, x = (np.mgrid[0:T, 0:T] + 0.5) / T - 0.5
    r = np.sqrt(x * x + y * y)
    a = np.arctan2(y, x)
    n = fnoise(T, beta=0.5, lo=40, seed=3)
    rust = fnoise(T, beta=1.6, lo=2, seed=4)
    # 0: manhole cover (cast iron, raised pattern, rim)
    disc = (r < 0.46).astype(float)
    rim = ((r > 0.42) & (r < 0.46)).astype(float)
    pattern = ((np.sin(x * 70) > 0.6) | (np.sin(y * 70) > 0.6)).astype(float) * (r < 0.36)
    ring = ((r > 0.36) & (r < 0.38)).astype(float)
    iron = np.stack([0.17 + rust * 0.12, 0.16 + rust * 0.07, 0.15 + rust * 0.03], -1) * (0.75 + 0.5 * n[..., None])
    out[:, 0:T, :3] = iron * (0.8 + 0.4 * pattern[..., None]) * (1 - rim[..., None] * 0.3)
    out[:, 0:T, 3] = np.clip((0.47 - r) / 0.01, 0, 1)
    hgt[:, 0:T] = disc * 0.3 + pattern * 0.3 + ring * 0.4 - rim * 0.2
    # 1: storm drain grate (rectangular, slots)
    gx, gy = np.abs(x), np.abs(y)
    box = ((gx < 0.46) & (gy < 0.22)).astype(float)
    slot = ((np.sin(x * 110) > 0.2) & (gy < 0.17) & (gx < 0.42)).astype(float)
    out[:, T:2 * T, :3] = np.stack([0.2 + rust * 0.1, 0.19 + rust * 0.06, 0.18 + rust * 0.03], -1) * (1 - slot[..., None] * 0.92)
    out[:, T:2 * T, 3] = box
    hgt[:, T:2 * T] = box * 0.3 - slot * 0.6
    # 2: oil / tyre stain (soft dark blot)
    blot = np.clip(1 - r / 0.45 + (fnoise(T, beta=1.4, lo=2, seed=5) - 0.5) * 0.9, 0, 1) ** 1.5
    out[:, 2 * T:3 * T, :3] = np.stack([0.03, 0.03, 0.035])[None, None, :] * np.ones((T, T, 1))
    out[:, 2 * T:3 * T, 3] = blot * 0.55
    hgt[:, 2 * T:3 * T] = 0
    # 3: crack network (thin dark lines)
    c1 = fnoise(T, beta=2.2, lo=2, hi=40, seed=6)
    c2 = fnoise(T, beta=2.2, lo=2, hi=40, seed=7)
    lines = np.clip(1 - np.abs(c1 - 0.5) / 0.012, 0, 1) * (c2 > 0.45) + np.clip(1 - np.abs(c2 - 0.55) / 0.008, 0, 1) * (c1 > 0.5)
    fade = np.clip(1 - r / 0.5, 0, 1)
    out[:, 3 * T:4 * T, :3] = 0.04
    out[:, 3 * T:4 * T, 3] = np.clip(lines, 0, 1) * fade * 0.9
    hgt[:, 3 * T:4 * T] = -np.clip(lines, 0, 1) * fade
    Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGBA').save(f'{OUT}/decals_albedo.png')
    nrm = normal_from_height(hgt, 8)
    Image.fromarray((np.clip(nrm, 0, 1) * 255).astype(np.uint8)).save(f'{OUT}/decals_normal.jpg', quality=90)
    print('wrote decals')


# ---------------------------------------------------------------- interiors
def grain(n=N, stretch=24, seed=None):
    """Wood-grain field: noise stretched along X (tileable)."""
    warp = fnoise(n, beta=2.0, lo=1, hi=12, seed=seed)
    yy = np.mgrid[0:n, 0:n][0] / n
    rings = np.sin((yy * 46 + warp * 9) * np.pi * 2) * 0.5 + 0.5
    rings = rings ** 3
    fine = blur(np.repeat(fnoise(n, beta=0.4, lo=60, seed=(seed or 0) + 1)[:, :: stretch], stretch, 1)[:, :n], 1)
    return np.clip(rings * 0.6 + fine * 0.4, 0, 1)


def woodfloor():
    # 4 m tile: 8 oak planks 19 cm wide, staggered board ends
    y, x = np.mgrid[0:N, 0:N] / N
    planks = 20
    row = np.floor(y * planks)
    off = (np.sin(row * 7.13) * 0.5 + 0.5)
    bx = (x + off) % 1
    blen = 0.5
    board = np.floor(bx / blen) + row * 3
    fy = (y * planks) % 1
    fx = (bx / blen) % 1
    gap = np.clip(np.minimum(np.minimum(fy, 1 - fy) / 0.06, np.minimum(fx, 1 - fx) / 0.01), 0, 1)
    g = grain(seed=11)
    tone = (np.sin(board * 12.9898) * 43758.5453) % 1
    oak = lerp3(col('#b98a5c'), col('#7a4a28'), np.clip(tone * 0.45 + g * 0.65, 0, 1))
    albedo = oak * (0.82 + 0.25 * g)[..., None] * (0.55 + 0.45 * gap)[..., None]
    h = gap * 0.6 + g * 0.15
    rough = 0.42 + g * 0.18 + (1 - gap) * 0.3
    save('woodfloor', albedo, h, rough, ao=0.6 + 0.4 * gap, nstrength=5)


def wood():
    # furniture timber, 1 m tile, long grain
    g = grain(seed=21)
    n = fnoise(beta=1.6, lo=1, seed=22)
    albedo = lerp3(col('#7a4e2c'), col('#4a2c18'), np.clip(g * 0.8 + n * 0.25, 0, 1))
    save('wood', albedo, g * 0.2, 0.45 + g * 0.2, nstrength=3)


def tiles():
    # 2.4 m tile: 4 x 4 porcelain tiles (60 cm) with grout
    y, x = np.mgrid[0:N, 0:N] / N
    fx, fy = (x * 4) % 1, (y * 4) % 1
    grout = np.clip(np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy)) / 0.008, 0, 1)
    tid = np.floor(x * 4) + np.floor(y * 4) * 5
    var = ((np.sin(tid * 12.9898) * 43758.5453) % 1) * 0.06
    n = fnoise(beta=1.5, lo=4, seed=31)
    albedo = lerp3(col('#d8d6d0'), col('#ecebe6'), np.clip(n * 0.6 + var * 4, 0, 1)) * (0.62 + 0.38 * grout)[..., None]
    h = grout * 0.5
    rough = 0.18 + (1 - grout) * 0.6 + n * 0.08
    save('tiles', albedo, h, rough, ao=0.6 + 0.4 * grout, nstrength=5)


def marble():
    # 3 m tile: large slabs with veining
    y, x = np.mgrid[0:N, 0:N] / N
    n = fnoise(beta=1.8, lo=1, seed=41)
    w = fnoise(beta=2.2, lo=1, hi=30, seed=42)
    veins = np.clip(1 - np.abs(np.sin((x * 3 + y * 1.4 + w * 2.5) * np.pi * 2)) / 0.04, 0, 1) * (fnoise(beta=1.0, lo=4, seed=43) > 0.45)
    fx, fy = (x * 2) % 1, (y * 2) % 1
    seam = np.clip(np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy)) / 0.002, 0, 1)
    albedo = lerp3(col('#e6e3dc'), col('#f6f4ef'), n) * (1 - veins[..., None] * 0.45) * (0.85 + 0.15 * seam)[..., None]
    albedo = albedo * (1 - veins[..., None] * np.array([0.05, 0.1, 0.15])[None, None, :])
    save('marble', albedo, seam * 0.3, 0.08 + n * 0.08 + (1 - seam) * 0.3, ao=0.8 + 0.2 * seam, nstrength=3)


def carpet():
    n = fnoise(beta=0.1, lo=300, seed=51)
    m = fnoise(beta=1.4, lo=2, seed=52)
    albedo = np.stack([0.55 + n * 0.25 + m * 0.1] * 3, -1)
    save('carpet', albedo, n, 0.97 + n * 0.03, nstrength=4)


def fabric_tex():
    y, x = np.mgrid[0:N, 0:N] / N
    weave = (np.sin(x * np.pi * 2 * 160) * np.sin(y * np.pi * 2 * 160) + 1) / 2
    n = fnoise(beta=0.6, lo=80, seed=61)
    m = fnoise(beta=1.6, lo=2, seed=62)
    albedo = np.stack([0.62 + weave * 0.12 + n * 0.12 + m * 0.08] * 3, -1)
    save('fabric', albedo, weave * 0.5 + n * 0.5, 0.88 + n * 0.1, nstrength=3)


def leather():
    cells = fnoise(beta=0.2, lo=120, hi=400, seed=71)
    m = fnoise(beta=1.8, lo=1, seed=72)
    h = blur(cells, 1)
    albedo = np.stack([0.6 + m * 0.2 + h * 0.15] * 3, -1)
    save('leather', albedo, h, 0.38 + h * 0.2 + m * 0.1, nstrength=3)


TARGETS = dict(woodfloor=woodfloor, wood=wood, tiles=tiles, marble=marble, carpet=carpet, fabric=fabric_tex, leather=leather, decals=decals, asphalt=asphalt, sidewalk=sidewalk, concrete=concrete, brick=brick, plaster=plaster, stone=stone, metal=metal, roof=roof, grass=grass)
for k in (sys.argv[1:] or TARGETS):
    TARGETS[k]()
