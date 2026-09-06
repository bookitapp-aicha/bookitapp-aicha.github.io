import io, re, base64, urllib.request
from collections import OrderedDict

css = io.open('fonts.css', encoding='utf-8').read()
chunks = re.findall(r"/\*\s*([a-z0-9\-]+)\s*\*/\s*(@font-face\s*\{.*?\})", css, re.S)
KEEP = {'latin', 'latin-ext'}

groups = OrderedDict()   # url -> dict
for subset, block in chunks:
    if subset not in KEEP:
        continue
    u = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", block)
    if not u:
        continue
    url = u.group(1)
    fam = re.search(r"font-family:\s*'([^']+)'", block).group(1)
    sty = re.search(r"font-style:\s*([^;]+);", block).group(1).strip()
    wgt = int(re.search(r"font-weight:\s*(\d+)", block).group(1))
    ur  = re.search(r"unicode-range:\s*([^;]+);", block).group(1).strip()
    g = groups.setdefault(url, {'fam': fam, 'sty': sty, 'w': set(), 'ur': ur, 'sub': subset})
    g['w'].add(wgt)

opener = urllib.request.build_opener()
opener.addheaders = [('User-Agent', 'Mozilla/5.0')]

out, total = [], 0
for url, g in groups.items():
    data = opener.open(url, timeout=30).read()
    total += len(data)
    b64 = base64.b64encode(data).decode('ascii')
    lo, hi = min(g['w']), max(g['w'])
    weight = str(lo) if lo == hi else "%d %d" % (lo, hi)
    print("  %-15s %-7s w:%-9s %-9s %6.1f KB" % (g['fam'], g['sty'], weight, g['sub'], len(data)/1024.0))
    out.append(
        "@font-face{font-family:'%s';font-style:%s;font-weight:%s;font-display:swap;"
        "src:url(data:font/woff2;base64,%s) format('woff2');unicode-range:%s}"
        % (g['fam'], g['sty'], weight, b64, g['ur'])
    )

blob = "\n".join(out)
io.open('fonts-inlined.css', 'w', encoding='utf-8').write(blob)
print("unique files: %d   raw woff2: %.0f KB   css out: %.0f KB" % (len(out), total/1024.0, len(blob)/1024.0))
