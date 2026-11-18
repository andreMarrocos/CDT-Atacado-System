"""Add/refresh a ?v=<version> on every local CSS/JS reference in index.html.

Browsers cache JS/CSS; without this a phone can load a new index.html with an old app.js.
Run before every commit that changes css/ or js/:   python3 tools/bump_version.py
"""
import os, re, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(ROOT, 'index.html')
version = time.strftime('%Y%m%d%H%M')
html = open(path, encoding='utf-8').read()
html, n = re.subn(r'((?:src|href)="(?:js|css|vendor)/[^"?]+)(\?v=[0-9]+)?"', lambda m: m.group(1) + '?v=' + version + '"', html)
open(path, 'w', encoding='utf-8').write(html)
print(f'{n} referências atualizadas para v={version}')
