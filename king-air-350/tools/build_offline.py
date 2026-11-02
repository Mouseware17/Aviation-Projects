"""Build king-air-350/offline/: a self-contained copy of the site (fonts and images
embedded) plus a web-app manifest and service worker. Run after editing index.html:
    python3 king-air-350/tools/build_offline.py
Needs network access the first time to download the Google Fonts files (cached in /tmp)."""
import re, base64, subprocess, os, json, hashlib, tempfile
SRC=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP=os.path.join(tempfile.gettempdir(),'ka350-fonts'); os.makedirs(TMP, exist_ok=True)
OUT=SRC+'/offline'
os.makedirs(OUT, exist_ok=True)
s=open(SRC+'/index.html').read()
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
# ---- fonts: keep latin subsets, embed woff2 as base64
FONTS_URL=re.search(r'<link rel="stylesheet" href="(https://fonts.googleapis.com/[^"]+)"', s).group(1).replace('&amp;','&')
css=subprocess.run(['curl','-sS','-A',UA,FONTS_URL],check=True,capture_output=True,text=True).stdout
blocks=re.findall(r'/\* latin \*/\s*(@font-face\s*\{.*?\})', css, re.S)
cache={}
def emb(m):
    url=m.group(1)
    if url not in cache:
        fn=TMP+'/'+hashlib.md5(url.encode()).hexdigest()+'.woff2'
        if not os.path.exists(fn): subprocess.run(['curl','-sS','-A',UA,url,'-o',fn],check=True)
        cache[url]='data:font/woff2;base64,'+base64.b64encode(open(fn,'rb').read()).decode()
    return 'url('+cache[url]+')'
faces='\n'.join(re.sub(r'url\((https://[^)]+)\)', emb, b) for b in blocks)
assert len(blocks)==9, len(blocks)
fontlinks=re.search(r'<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect"[^\n]*\n<link rel="stylesheet" href="https://fonts.googleapis.com[^\n]*\n', s)
s=s.replace(fontlinks.group(0), '<style>\n'+faces+'\n</style>\n')
# ---- images: inline as data URIs
imgs={}
for f in sorted(os.listdir(SRC+'/img/general')):
    imgs[f[:-4]]='data:image/jpeg;base64,'+base64.b64encode(open(SRC+'/img/general/'+f,'rb').read()).decode()
assert s.count('img/general/${f}.jpg')==2
s=s.replace('img/general/${f}.jpg','${GN_IMG[f]}')
s=s.replace('/* ================= boot ================= */', 'const GN_IMG = '+json.dumps(imgs)+';\n\n/* ================= boot ================= */',1)
# ---- PWA hooks
s=s.replace('<title>King Air 350 Systems</title>','''<title>King Air 350 Systems</title>
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#3b4148">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="KA350">
<link rel="apple-touch-icon" href="icon-192.png">
<link rel="icon" href="icon-192.png">''',1)
s=s.replace('</body>','''<script>
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
</script>
</body>''',1)
assert 'fonts.googleapis' not in s and 'img/general' not in s
open(OUT+'/index.html','w').write(s)
ver=hashlib.md5(s.encode()).hexdigest()[:10]
open(OUT+'/sw.js','w').write(f'''/* Offline cache for the King Air 350 study site. Version changes with every build. */
const CACHE = "ka350-{ver}";
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => {{
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
}});
self.addEventListener("activate", e => {{
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
}});
/* network first so updates arrive when online; fall back to the cache offline */
self.addEventListener("fetch", e => {{
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then(r => {{
    if (r.ok && new URL(e.request.url).origin === location.origin) {{ const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }}
    return r;
  }}).catch(() => caches.match(e.request, {{ ignoreSearch: true }}).then(r => r || caches.match("index.html"))));
}});
''')
json.dump({"name":"King Air 350 Systems","short_name":"KA350","start_url":"./","scope":"./","display":"standalone",
  "background_color":"#e8ecf0","theme_color":"#3b4148",
  "icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"any maskable"}]},
  open(OUT+'/manifest.webmanifest','w'), indent=2)
# ---- icons
from PIL import Image, ImageDraw, ImageFont
def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()
for n in (192,512):
    im=Image.new('RGB',(n,n),'#3b4148'); d=ImageDraw.Draw(im)
    d.rectangle([n*.12,n*.12,n*.88,n*.88],outline='#59616a',width=max(2,n//64))
    for txt,y,sz,col in (('KING AIR',.36,.13,'#aab2bb'),('350',.58,.30,'#f1f3f5')):
        f=font(int(n*sz)); w=d.textlength(txt,font=f); d.text(((n-w)/2,n*y),txt,font=f,fill=col,anchor='lm')
    d.rectangle([n*.3,n*.76,n*.7,n*.79],fill='#33b864')
    im.save(f'{OUT}/icon-{n}.png')
print('ok', len(s)//1024, 'KB', ver)
