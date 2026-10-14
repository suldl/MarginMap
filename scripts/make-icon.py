"""Rasterizes the app icon (same design as public/icon.svg) to build/icon.png.

Pure standard library so it runs anywhere: python scripts/make-icon.py
"""
import os
import struct
import zlib

SIZE = 512
SS = 3  # supersampling factor per axis
U = SIZE / 64.0  # svg units -> pixels


def rounded_rect(x, y, w, h, r):
    def inside(px, py):
        if px < x or py < y or px > x + w or py > y + h:
            return False
        cx = min(max(px, x + r), x + w - r)
        cy = min(max(py, y + r), y + h - r)
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
    return inside


def segment(x1, y1, x2, y2, half):
    def inside(px, py):
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
        qx, qy = x1 + t * dx, y1 + t * dy
        return (px - qx) ** 2 + (py - qy) ** 2 <= half * half
    return inside


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


bg = rounded_rect(0, 0, 64, 64, 14)
white_shapes = [
    rounded_rect(9, 25, 14, 14, 3.5),
    rounded_rect(38, 13, 17, 11, 3),
    rounded_rect(38, 40, 17, 11, 3),
    segment(23, 32, 31, 32, 1.5),
    segment(31, 18.5, 31, 45.5, 1.5),
    segment(31, 18.5, 38, 18.5, 1.5),
    segment(31, 45.5, 38, 45.5, 1.5),
]
yellow = rounded_rect(38, 13, 5, 11, 2)
green = rounded_rect(38, 40, 5, 11, 2)

C1 = (0x4C, 0x7C, 0xF7)
C2 = (0x8D, 0x5C, 0xF0)
WHITE = (255, 255, 255)
YELLOW = (0xF2, 0xC2, 0x30)
GREEN = (0x4D, 0xBF, 0x63)

rows = []
for py in range(SIZE):
    row = bytearray([0])
    for px in range(SIZE):
        acc = [0.0, 0.0, 0.0, 0.0]
        for sy in range(SS):
            for sx in range(SS):
                x = (px + (sx + 0.5) / SS) / U
                y = (py + (sy + 0.5) / SS) / U
                if not bg(x, y):
                    continue
                if yellow(x, y):
                    col = YELLOW
                elif green(x, y):
                    col = GREEN
                elif any(s(x, y) for s in white_shapes):
                    col = WHITE
                else:
                    col = lerp(C1, C2, (x + y) / 128.0)
                acc[0] += col[0]
                acc[1] += col[1]
                acc[2] += col[2]
                acc[3] += 1
        n = SS * SS
        if acc[3]:
            row += bytes([round(acc[0] / acc[3]), round(acc[1] / acc[3]), round(acc[2] / acc[3]), round(255 * acc[3] / n)])
        else:
            row += bytes([0, 0, 0, 0])
    rows.append(bytes(row))


def chunk(tag, data):
    c = struct.pack('>I', len(data)) + tag + data
    return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
png += chunk(b'IEND', b'')

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build', 'icon.png')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'wb') as f:
    f.write(png)
print('wrote', os.path.normpath(out))
