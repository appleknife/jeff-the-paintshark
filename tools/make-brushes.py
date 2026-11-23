"""Generate Jeff's look-alike brush tips and paper grains.

Pure stdlib (zlib + struct); deterministic so the PNGs are reproducible and our
own. Parameters for the presets were recovered from a shipped paint app, but
these pixels are generated here rather than copied from its assets.
"""
import math
import random
import struct
import zlib
from pathlib import Path

SIZE = 256
OUT = Path(__file__).resolve().parent.parent / "assets" / "brushes"
OUT.mkdir(parents=True, exist_ok=True)


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def smoothstep(a, b, x):
    t = clamp((x - a) / (b - a)) if b != a else 0.0
    return t * t * (3 - 2 * t)


def write_png(name, pix):
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)
        raw.extend(pix[y * SIZE * 4:(y + 1) * SIZE * 4])
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    (OUT / name).write_bytes(png)


def blank():
    return bytearray(SIZE * SIZE * 4)


def white_alpha(alpha):
    pix = bytearray(SIZE * SIZE * 4)
    for i, a in enumerate(alpha):
        if a:
            o = i * 4
            pix[o:o + 4] = bytes((255, 255, 255, a))
    return pix


def fbm(rnd, amps):
    sizes = (8, 16, 32, 64)
    grids = [[rnd.random() for _ in range(n * n)] for n in sizes]
    def sample(u, v):
        total, norm = 0.0, 0.0
        for grid, n, amp in zip(grids, sizes, amps):
            x, y = u * n, v * n
            x0, y0 = int(x) % n, int(y) % n
            x1, y1 = (x0 + 1) % n, (y0 + 1) % n
            fx, fy = x - int(x), y - int(y)
            a = grid[y0 * n + x0] * (1 - fx) + grid[y0 * n + x1] * fx
            b = grid[y1 * n + x0] * (1 - fx) + grid[y1 * n + x1] * fx
            total += (a * (1 - fy) + b * fy) * amp
            norm += amp
        return total / norm
    return sample


def pencil():
    rnd = random.Random(11)
    rough = fbm(rnd, (1, 1, 0.9, 0.8))
    streak = [rnd.uniform(0.35, 1.0) for _ in range(SIZE)]
    alpha = bytearray(SIZE * SIZE)
    for y in range(SIZE):
        cy = 128 + math.sin(y * 0.0) * 0 + (y - 128) * 0
        for x in range(SIZE):
            band = abs(y - (128 + math.sin(x * 0.045) * 7))
            core = math.exp(-(band / 32) ** 2 * 1.5)
            taper = smoothstep(4, 34, x) * smoothstep(4, 34, SIZE - x)
            n = 0.65 + 0.5 * rough(x / SIZE, y / SIZE)
            n *= 0.55 + 0.55 * streak[(x + int(math.sin(y * 0.2) * 3)) % SIZE]
            if rnd.random() < 0.03:
                n *= 0.2
            alpha[y * SIZE + x] = int(255 * clamp(core * taper * n))
    return alpha


def pen():
    rnd = random.Random(23)
    noise = fbm(rnd, (0.2, 0.2, 0.2, 0.2))
    alpha = bytearray(SIZE * SIZE)
    for y in range(SIZE):
        for x in range(SIZE):
            r = math.hypot(x - 128, y - 128)
            a = 1 - smoothstep(98, 104, r)
            if a:
                a *= 0.86 + 0.14 * noise(x / SIZE, y / SIZE)
            alpha[y * SIZE + x] = int(255 * clamp(a) ** 0.9)
    return alpha


def calligraphy():
    ang = math.radians(35)
    ca, sa = math.cos(ang), math.sin(ang)
    alpha = bytearray(SIZE * SIZE)
    for y in range(SIZE):
        for x in range(SIZE):
            dx, dy = x - 128, y - 128
            u = abs(dx * ca + dy * sa)
            v = abs(-dx * sa + dy * ca)
            a = (1 - smoothstep(18, 22, u)) * (1 - smoothstep(84, 92, v))
            alpha[y * SIZE + x] = int(255 * clamp(a) ** 0.8)
    return alpha


def air():
    rnd = random.Random(31)
    grain = fbm(rnd, (0.15, 0.15, 0.15, 0.15))
    alpha = bytearray(SIZE * SIZE)
    for y in range(SIZE):
        for x in range(SIZE):
            r = math.hypot(x - 128, y - 128) / 128
            a = math.exp(-(r * 1.65) ** 2) * (0.82 + 0.18 * grain(x / SIZE, y / SIZE))
            alpha[y * SIZE + x] = int(255 * clamp(a))
    return alpha


def charcoal():
    rnd = random.Random(47)
    clump = fbm(rnd, (1, 1, 1, 0.9))
    speck = fbm(rnd, (0.2, 0.2, 0.2, 0.2))
    alpha = bytearray(SIZE * SIZE)
    for y in range(SIZE):
        for x in range(SIZE):
            r = math.hypot(x - 128, y - 128)
            base = 1 - smoothstep(88, 118, r)
            n = 0.35 + 0.9 * clump(x / SIZE, y / SIZE)
            n *= 0.55 + 0.75 * speck(x / SIZE, y / SIZE)
            if rnd.random() < 0.05:
                n *= 0.15
            alpha[y * SIZE + x] = int(255 * clamp(base * n))
    return alpha


def water():
    rnd = random.Random(59)
    blot = fbm(rnd, (0.6, 0.6, 0.6, 0.6))
    alpha = bytearray(SIZE * SIZE)
    for y in range(SIZE):
        for x in range(SIZE):
            r = math.hypot(x - 128, y - 128) / 128
            a = (1 - smoothstep(0.25, 0.95, r)) ** 1.1
            a *= 0.5 + 0.7 * blot(x / SIZE, y / SIZE)
            alpha[y * SIZE + x] = int(255 * clamp(a))
    return alpha


def paper(seed, fine, fibres):
    rnd = random.Random(seed)
    grain = fbm(rnd, (0.7, 0.7, 0.7, 0.7))
    alpha = bytearray(255 for _ in range(SIZE * SIZE))
    for y in range(SIZE):
        for x in range(SIZE):
            v = 235 - fine * rnd.random() * 90
            v -= grain(x / SIZE, y / SIZE) * 120
            alpha[y * SIZE + x] = int(clamp(v, 20, 255))
    for _ in range(fibres):
        x, y = rnd.random() * SIZE, rnd.random() * SIZE
        a = rnd.uniform(-0.5, 0.5)
        ln = rnd.randint(4, 26)
        for i in range(ln):
            xx, yy = int(x + math.cos(a) * i), int(y + math.sin(a) * i)
            if 0 <= xx < SIZE and 0 <= yy < SIZE:
                k = yy * SIZE + xx
                alpha[k] = int(clamp(alpha[k] - rnd.uniform(15, 55), 15, 255))
    return alpha


def main():
    tips = {
        "brush_pencil_graphite.png": pencil(),
        "brush_pen01.png": pen(),
        "brush_flat_calligraphy.png": calligraphy(),
        "brush_air03.png": air(),
        "brush_chalk_charcoal.png": charcoal(),
        "brush_water_real_mask.png": water(),
    }
    for name, a in tips.items():
        write_png(name, white_alpha(a))
    grains = {
        "paper_texture_05_mask.png": paper(61, 0.9, 900),
        "paper_texture_10_mask.png": paper(67, 0.55, 500),
    }
    for name, a in grains.items():
        write_png(name, white_alpha(a))
    print("wrote", len(list(OUT.glob("*.png"))), "brush assets to", OUT)


if __name__ == "__main__":
    main()
