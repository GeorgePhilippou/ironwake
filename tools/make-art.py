#!/usr/bin/env python3
"""Regenerate icon PNGs and iPad launch (splash) images from icons/icon.svg.
Needs rsvg-convert (brew install librsvg). Run from the repo root: python3 tools/make-art.py
Only needed when the artwork changes; the outputs are committed."""
import re, subprocess, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
icon = (ROOT / 'icons/icon.svg').read_text()
inner = icon[icon.index('<defs>'):icon.rindex('</svg>')]

def render(svg, w, h, out):
    tmp = ROOT / 'tools/_tmp.svg'
    tmp.write_text(svg)
    subprocess.run(['rsvg-convert', '-w', str(w), '-h', str(h), str(tmp), '-o', str(ROOT / out)], check=True)
    tmp.unlink()

# Icons
for size, name in [(180, 'apple-touch-icon'), (192, 'icon-192'), (512, 'icon-512')]:
    render(icon, size, size, f'icons/{name}.png')
maskable = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#06161c"/>'
            '<g transform="translate(102.4 102.4) scale(0.8)">'
            + inner.replace('<rect width="1024" height="1024" fill="url(#bg)"/>', '<circle cx="512" cy="512" r="640" fill="url(#bg)"/>')
            + '</g></svg>')
render(maskable, 512, 512, 'icons/icon-maskable-512.png')
render((ROOT / 'icons/favicon.svg').read_text(), 32, 32, 'icons/favicon-32.png')

# Launch images: every iPad point size, portrait and landscape, at 2x.
IPADS = [(744, 1133), (768, 1024), (810, 1080), (820, 1180), (834, 1112), (834, 1194), (834, 1210), (1024, 1366), (1032, 1376)]
emblem = inner.replace('<rect width="1024" height="1024" fill="url(#bg)"/>', '')
links = []
for w, h in IPADS:
    for orient, (pw, ph) in (('portrait', (w, h)), ('landscape', (h, w))):
        W, H = pw * 2, ph * 2
        e = round(min(W, H) * 0.30)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
               f'<rect width="{W}" height="{H}" fill="#04090d"/>'
               f'<g transform="translate({(W - e) / 2} {H / 2 - e * 0.62}) scale({e / 1024})">{emblem}</g>'
               f'<text x="{W / 2 + e * 0.045}" y="{H / 2 + e * 0.78}" text-anchor="middle" font-family="DIN Condensed, Avenir Next Condensed, Arial Narrow, sans-serif" '
               f'font-weight="700" font-size="{e * 0.36}" letter-spacing="{e * 0.07}" fill="#dff5f0">IRONWAKE</text></svg>')
        name = f'splash/ipad-{w}x{h}-{orient}.png'
        render(svg, W, H, name)
        links.append(f'<link rel="apple-touch-startup-image" media="screen and (device-width: {w}px) and (device-height: {h}px) '
                     f'and (-webkit-device-pixel-ratio: 2) and (orientation: {orient})" href="{name}">')

index = ROOT / 'index.html'
html = index.read_text()
html = re.sub(r'<!--SPLASH-->.*?<!--/SPLASH-->', '<!--SPLASH-->\n' + '\n'.join(links) + '\n<!--/SPLASH-->', html, flags=re.S)
index.write_text(html)
print(f'{len(links)} launch images written')
