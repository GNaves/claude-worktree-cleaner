"""Gera os ícones do app (rode: python3 tools/make-icons.py). Requer Pillow."""
from PIL import Image, ImageDraw
import math, os

ROOT = os.path.join(os.path.dirname(__file__), '..')
SS = 8  # supersampling


def bez(p0, p1, p2, p3, n=40):
    pts = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 3; b = 3 * (1 - t) ** 2 * t; c = 3 * (1 - t) * t ** 2; d = t ** 3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts


def glyph(size, color, bg=None, pad=0.0, bold=1.0):
    """Branch de git (3 nós) + brilho de 'limpeza'. Coordenadas em grade 100x100."""
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = S / 100 * (1 - pad * 2)
    off = S * pad
    P = lambda x, y: (off + x * k, off + y * k)
    w = 9 * bold * k

    def line(pts):
        pp = [P(*p) for p in pts]
        d.line(pp, fill=color, width=int(w), joint='curve')
        for x, y in (pp[0], pp[-1]):
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=color)

    line([(30, 20), (30, 80)])  # tronco
    line(bez((66, 32), (66, 52), (30, 50), (30, 70)))  # ramo

    for cx, cy in [(30, 20), (30, 80), (66, 30)]:  # nós
        x, y = P(cx, cy); r = 11 * bold * k
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)

    # brilho (4 pontas) no canto inferior direito
    cx, cy = P(76, 76); R = 15 * bold * k; r = 5 * bold * k
    star = []
    for i in range(8):
        a = math.pi / 4 * i - math.pi / 2
        rad = R if i % 2 == 0 else r
        star.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    d.polygon(star, fill=color)

    out = img.resize((size, size), Image.LANCZOS)
    if bg:
        base = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        m = Image.new('L', (S, S), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
        base.paste(Image.new('RGBA', (size, size), bg), mask=m.resize((size, size), Image.LANCZOS))
        base.alpha_composite(out)
        return base
    return out


def save(img, *p):
    path = os.path.join(ROOT, *p)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print('ok', os.path.normpath(path))


ORANGE = (217, 119, 87, 255)
# macOS: template (preto + alpha; o sistema adapta ao tema claro/escuro)
save(glyph(16, (0, 0, 0, 255), bold=1.3), 'src', 'assets', 'iconTemplate.png')
save(glyph(32, (0, 0, 0, 255), bold=1.3), 'src', 'assets', 'iconTemplate@2x.png')
# Linux: colorido, legível em painel claro e escuro
save(glyph(44, ORANGE, bold=1.2), 'src', 'assets', 'icon.png')
# Ícone do app (dmg/AppImage/deb)
save(glyph(1024, (255, 255, 255, 255), bg=ORANGE, pad=0.16), 'build', 'icon.png')
