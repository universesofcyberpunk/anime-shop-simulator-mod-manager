'use strict';
// Mod Yoneticisi cekirdegi: durum dosyasi, icerik ozeti, derle/paketle/yayinla islemleri.
// server.js (web sayfasi) ve mod.js (komut satiri) ikisi de bunu kullanir.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const TOOL = __dirname;
// config.json (optional, next to this file) overrides the default layout; see config.example.json.
// Default layout: <game>\ModDev\<any folder>\<this tool>, mods in ModDev\Mods, zips in ModDev\Release.
const CFG = (() => { try { return JSON.parse(fs.readFileSync(path.join(TOOL, 'config.json'), 'utf8')); } catch { return {}; } })();
const MODDEV = CFG.modDev ? path.resolve(TOOL, CFG.modDev) : path.resolve(TOOL, '..', '..');
const GAME = CFG.gameDir ? path.resolve(TOOL, CFG.gameDir) : path.resolve(MODDEV, '..');
const FILES = path.join(MODDEV, CFG.filesFolder || 'Files');
const STATE = path.join(FILES, 'mod_durum.json');
const REL = path.join(MODDEV, CFG.releaseFolder || 'Release');
const PUB = path.join(MODDEV, CFG.publishedFolder || 'Yayınlanan Modlar');
const CACHE = path.join(TOOL, '.ozet_onbellek.json');
const NEXUS_TXT = path.join(FILES, 'NEXUS_YAYINLANANLAR.txt');
const PLAN_MD = path.join(FILES, 'YAYINLANACAKLAR.md');
const BACKUP = path.join(FILES, '_yedek');
const GAME_EXE = CFG.gameExe || 'Anime Shop Simulator.exe';
const NEXUS_GAME = CFG.nexusGame || 'animeshopsimulator';
const AUTHOR = CFG.author || 'Fabianens';
const NEXUS_PROFILE = CFG.nexusProfile || 'https://www.nexusmods.com/profile/Fabianens/mods?gameId=10172';
const PORT = CFG.port || 5170;

// her derinlikte ozete girmeyen klasor/dosya adlari (derleme ciktisi, gecici paket, tani dosyalari)
const SKIP_NAMES = new Set(['bin', 'obj', '_pkg', '_imgpkg', '.vs', '__pycache__', '_paketle_log.txt',
  'derle.bat', 'paketle.bat', 'paketle_resimler.bat', 'renderers.txt', 'skeleton.txt', 'catalog.txt', '_icons', '_unpriced_seen.txt', 'skeleton_dump.txt']);
// oyun calisirken modlarin UserData'ya yazdigi dosyalar (degisiklik sayilmaz)
const SKIP_RE = [/^_(market|unpriced)/i, /^Scale_Slot\d*\.txt$/i, /^(category_audit|texture_names|settings_game)\.txt$/i, /_log\.txt$/i, /\.user$/i, /^~\$/, /\.tmp$/i];

const STAGES = {
  yayinda: 'Yayında',
  yayin_bekliyor: 'Yayın bekliyor',
  paketlenecek: 'Paketlenecek',
  test_bekliyor: 'Test bekliyor',
  derleme_hatasi: 'Derleme hatası',
  derlenecek: 'Derlenecek',
  yeni: 'Yeni',
  yayinlanmayacak: 'Yayınlanmayacak',
  kaynak_yok: 'Kaynak bulunamadı',
};

// ---------- yardimcilar ----------
const slash = p => p.replace(/\\/g, '/');
const abs = rel => path.join(GAME, rel);
const relToGame = p => slash(path.relative(GAME, p));
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const now = () => new Date().toISOString();
function trTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function trDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function fail(msg) { const e = new Error(msg); e.user = true; throw e; }
function nexusUrl(id) { return id ? `https://www.nexusmods.com/${NEXUS_GAME}/mods/${id}` : null; }

// ---------- durum dosyasi ----------
function emptyState() { return { surum: 1, ayarlar: { testZorunlu: true }, modlar: {}, gecmis: [] }; }
function load() {
  if (!exists(STATE)) return emptyState();
  const s = JSON.parse(fs.readFileSync(STATE, 'utf8').replace(/^﻿/, ''));
  s.modlar = s.modlar || {}; s.gecmis = s.gecmis || []; s.ayarlar = s.ayarlar || { testZorunlu: true };
  return s;
}
function save(s) {
  if (s.gecmis.length > 500) s.gecmis = s.gecmis.slice(-500);
  const tmp = STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
  fs.renameSync(tmp, STATE);
}
// oku - degistir - yaz (diger oturumun yazdiklari kaybolmasin diye her seferinde yeniden okunur)
function mutate(fn) { const s = load(); const r = fn(s); save(s); return r; }
function addLog(s, by, mod, action, msg) { s.gecmis.push({ zaman: now(), kim: by || '?', mod, islem: action, mesaj: msg }); }
function getMod(s, id) {
  const m = s.modlar[id] || Object.values(s.modlar).find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!m) fail(`Listede yok: ${id}. 'node mod.js liste' ile adlara bak ya da 'node mod.js ekle ${id}' ile ekle.`);
  return m;
}

// ---------- icerik ozeti ----------
let cache = null, cacheDirty = false;
function loadCache() { if (!cache) { try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { cache = {}; } } return cache; }
function flushCache() { if (cacheDirty) { fs.writeFileSync(CACHE, JSON.stringify(cache)); cacheDirty = false; } }
function fileHash(p, st) {
  const c = loadCache(), k = slash(p).toLowerCase(), e = c[k];
  if (e && e.s === st.size && e.m === st.mtimeMs) return e.h;
  const h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
  c[k] = { s: st.size, m: st.mtimeMs, h }; cacheDirty = true;
  return h;
}
function skipped(name, full, excl) {
  if (SKIP_NAMES.has(name.toLowerCase()) || SKIP_RE.some(r => r.test(name))) return true;
  return excl.has(slash(full).toLowerCase());
}
function walk(dir, excl, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (skipped(e.name, f, excl)) continue;
    if (e.isDirectory()) walk(f, excl, out); else if (e.isFile()) out.push(f);
  }
}
function globRe(pat) { return new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'); }
function inputFiles(m) {
  const excl = new Set((m.haric || []).map(x => slash(abs(x)).toLowerCase()));
  const out = [];
  for (const inp of m.girdiler || []) {
    const full = abs(inp), base = path.basename(full);
    if (/[*?]/.test(base)) {
      const dir = path.dirname(full), re = globRe(base);
      let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { }
      for (const e of ents) if (re.test(e.name) && !skipped(e.name, path.join(dir, e.name), excl)) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f, excl, out); else out.push(f);
      }
    } else if (isDir(full)) walk(full, excl, out);
    else if (exists(full)) out.push(full);
  }
  return [...new Set(out)];
}
function locate(m) {
  const r = path.join(REL, m.release), p = path.join(PUB, m.release);
  const inR = isDir(r), inP = isDir(p);
  const where = inR && inP ? 'ikisi' : inR ? 'release' : inP ? 'yayinlanan' : null;
  const dir = inR ? r : inP ? p : null;
  let zips = [];
  if (dir) zips = fs.readdirSync(dir).filter(f => /\.zip$/i.test(f)).map(f => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }));
  zips.sort((a, b) => b.t - a.t);
  return { where, dir, zips, zip: zips[0] ? zips[0].f : null, zipTime: zips[0] ? new Date(zips[0].t).toISOString() : null };
}
// kaynak ozeti: girdiler varsa onlarin icerigi, yoksa (elle tutulan paketler) zip dosyalarinin icerigi
function computeHash(m, loc) {
  let files;
  if ((m.girdiler || []).length) files = inputFiles(m);
  else files = (loc || locate(m)).zips.map(z => z.f);
  if (!files.length) return { hash: null, newest: null, count: 0 };
  const rows = []; let newest = 0;
  for (const f of files) {
    const st = fs.statSync(f); newest = Math.max(newest, st.mtimeMs);
    const key = (m.girdiler || []).length ? relToGame(f).toLowerCase() : path.basename(f).toLowerCase();
    rows.push(key + '\0' + fileHash(f, st));
  }
  rows.sort();
  return { hash: crypto.createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16), newest: new Date(newest).toISOString(), count: files.length };
}
function readVersion(m) {
  if (!m.kaynak) return null;
  const dir = abs(m.kaynak); if (!isDir(dir)) return null;
  const files = [];
  for (const f of fs.readdirSync(dir)) if (/\.cs$/i.test(f)) files.push(path.join(dir, f));
  const props = path.join(dir, 'Properties'); if (isDir(props)) for (const f of fs.readdirSync(props)) if (/\.cs$/i.test(f)) files.push(path.join(props, f));
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8'), mm = /MelonInfo\s*\([^,]+,\s*"[^"]*"\s*,\s*"([^"]+)"/.exec(t);
    if (mm) return mm[1];
  }
  return null;
}

// ---------- durum hesabi ----------
function evaluate(m, loc, h) {
  const hs = m.adimlar || {}, cur = h.hash;
  if (m.yayinlanmayacak) return 'yayinlanmayacak';
  if (!cur) return 'kaynak_yok';
  if (hs.yayin && hs.yayin.ozet === cur) return 'yayinda';
  if (hs.paket && hs.paket.ozet === cur && loc.zip) return 'yayin_bekliyor';
  if (hs.test && hs.test.ozet === cur) return 'paketlenecek';
  if (m.derleme && hs.derleme && hs.derleme.ozet === cur) return hs.derleme.basarili ? 'test_bekliyor' : 'derleme_hatasi';
  if (!m.derleme) return 'test_bekliyor';
  return (hs.derleme || hs.yayin || hs.paket) ? 'derlenecek' : 'yeni';
}
function view(m, s, opts = {}) {
  const loc = locate(m), h = computeHash(m, loc), st = evaluate(m, loc, h), hs = m.adimlar || {};
  const version = readVersion(m);
  const updated = !!(hs.yayin && st !== 'yayinda' && st !== 'yayinlanmayacak');
  const tested = !!(hs.test && hs.test.ozet === h.hash);
  const testReq = s.ayarlar.testZorunlu !== false;
  const v = {
    id: m.id, ad: m.ad || m.id, tur: m.tur || 'mod', surum: version, durum: st, durumYazi: STAGES[st],
    guncellendi: updated, yayindakiSurum: hs.yayin ? hs.yayin.surum || '?' : null,
    yer: loc.where, zip: loc.zip ? relToGame(loc.zip) : null, zipZamani: loc.zipTime,
    nexus: m.nexus || null, not: m.not || '', yayinlanmayacak: !!m.yayinlanmayacak,
    testEdildi: tested, sonDerleme: hs.derleme || null, sonPaket: hs.paket || null, sonYayin: hs.yayin || null,
    ozet: h.hash, girdiSayisi: h.count, kaynakZamani: h.newest,
    yapilabilir: {
      derle: !!m.derleme && !m.yayinlanmayacak,
      calisiyor: !!(h.hash && !tested && !m.yayinlanmayacak && (!m.derleme || (hs.derleme && hs.derleme.ozet === h.hash && hs.derleme.basarili))),
      paketle: !!m.paket && !m.yayinlanmayacak && (st === 'paketlenecek' || (!testReq && ['test_bekliyor', 'derlenecek', 'yeni'].includes(st))),
      yayinlandi: !!loc.zip && !m.yayinlanmayacak && st !== 'yayinda',
    },
  };
  v.toplu = !m.topluHaric && !m.yayinlanmayacak;
  v.kaynakVar = !!(m.kaynak && isDir(abs(m.kaynak)));
  if (opts.detay) Object.assign(v, { kaynak: m.kaynak, release: m.release, derleme: m.derleme, paket: m.paket, girdiler: m.girdiler, haric: m.haric || [], adimlar: hs });
  return v;
}

// ---------- gereksinimler ----------
// Kaynak: paketteki README'nin "Requirements" bolumu; elle girilirse (m.gereksinimler) o kullanilir.
// tur: gerekli | onerilen | cakisir ; min: en dusuk surum
const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const DEP_ALIAS = [['fabianensmodmarket', 'ModMarket'], ['modmarket', 'ModMarket'], ['modsettings', 'ModSettings'],
  ['firstandthirdpersonbody', 'FirstAndThirdPersonBody'], ['ftpv', 'FirstAndThirdPersonBody'], ['fbsfabianensbodystudio', 'FBSBody'],
  ['fabianensbodystudio', 'FBSBody'], ['cardstudio', 'CardStudio'], ['dakimakurastudio', 'DakimakuraStudio'], ['mangastudio', 'MangaStudio'],
  ['figureshop', 'FigureShop'], ['employeeskinchanger', 'EmployeeSkinChanger'], ['playasmint', 'PlayAsMint'], ['fpsdoctor', 'FPSDoctor']];
const readmeCache = new Map();
function matchMod(text, s) {
  const n = norm(text); if (!n) return null;
  for (const m of Object.values(s.modlar)) if ([m.id, m.ad, m.nexus && m.nexus.baslik].some(x => x && norm(x) === n)) return m.id;
  for (const [k, id] of DEP_ALIAS) if (n === k || n.startsWith(k)) return s.modlar[id] ? id : null;
  return null;
}
function readmeDeps(m, s) {
  const loc = locate(m); if (!loc.dir) return [];
  const f = fs.readdirSync(loc.dir).find(x => /^README_.*\.txt$/i.test(x)); if (!f) return [];
  const p = path.join(loc.dir, f), key = p + '|' + fs.statSync(p).mtimeMs;
  if (!readmeCache.has(key)) {
    const items = []; let on = false;
    for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      if (/\[b\]Requirements\[\/b\]/i.test(l)) { on = true; continue; }
      if (on && /^\[size=/i.test(l)) break;
      if (on && /\[\*\]/.test(l)) items.push(l);
    }
    readmeCache.set(key, items);
  }
  const out = [];
  for (const l of readmeCache.get(key)) {
    if (/needed by|side by side|not\[\/b\] needed|not needed/i.test(l)) continue;
    const tur = /not together/i.test(l) ? 'cakisir' : /recommended|optional/i.test(l) ? 'onerilen' : 'gerekli';
    const cands = []; let x;
    const rb = /\[b\]([^\[]+)\[\/b\]/gi; while ((x = rb.exec(l))) cands.push(x[1]);
    const rq = /"([^"]+)"/g; while ((x = rq.exec(l))) cands.push(x[1]);
    let id = null;
    for (const c of cands) { id = matchMod(c.replace(/^\s*(requires|required:?|gerekli:?)\s*/i, ''), s); if (id) break; }
    if (!id) { const n = norm(l); for (const [k, v] of DEP_ALIAS) if (k.length >= 8 && n.includes(k) && s.modlar[v]) { id = v; break; } }
    if (!id || id === m.id || out.some(d => d.id === id)) continue;
    const mv = /(\d+\.\d+(?:\.\d+)?)\)?\s*(?:or newer|\+|ve üzeri|veya üstü)/i.exec(l);
    out.push(mv ? { id, tur, min: mv[1] } : { id, tur });
  }
  return out;
}
function depsOf(m, s) { return Array.isArray(m.gereksinimler) ? m.gereksinimler : readmeDeps(m, s); }
function cmpVer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
// her view'a gereksinimler (+ sorun) ve tersini (bagimlilar: bu moda ihtiyac duyanlar) ekler
function attachDeps(views, s) {
  const byId = Object.fromEntries(views.map(v => [v.id, v]));
  for (const v of views) v.bagimlilar = [];
  for (const v of views) {
    const m = s.modlar[v.id];
    v.gereksinimElle = Array.isArray(m.gereksinimler);
    v.gereksinimler = depsOf(m, s).map(d => {
      const t = byId[d.id], r = { ...d, ad: t ? t.ad : d.id };
      if (!t) r.sorun = 'listede yok';
      else if (d.tur !== 'cakisir') {
        if (d.min && t.surum && cmpVer(t.surum, d.min) < 0) r.sorun = `sürümü ${t.surum}, en az ${d.min} gerekli`;
        else if (d.min && t.yayindakiSurum && t.yayindakiSurum !== '?' && cmpVer(t.yayindakiSurum, d.min) < 0) r.sorun = `yayındaki sürümü ${t.yayindakiSurum}, en az ${d.min} gerekli`;
        else if (d.tur === 'gerekli' && t.durum !== 'yayinda') r.sorun = t.sonYayin ? `son hali (${t.surum || '-'}) henüz yayında değil` : 'henüz yayınlanmadı';
      }
      if (t) t.bagimlilar.push({ id: v.id, ad: v.ad, tur: d.tur });
      return r;
    });
  }
  return views;
}
function allViews(s) { const vs = Object.values(s.modlar).map(m => view(m, s)); attachDeps(vs, s); flushCache(); return vs; }
function parseDepText(text, s) {
  const out = [];
  for (let tok of String(text).split(/[;,]/).map(x => x.trim()).filter(Boolean)) {
    let tur = 'gerekli';
    if (tok.startsWith('?')) { tur = 'onerilen'; tok = tok.slice(1); } else if (tok.startsWith('!')) { tur = 'cakisir'; tok = tok.slice(1); }
    const mm = /^(.+?)\s*(?:>=\s*([\d.]+))?$/.exec(tok.trim());
    const id = matchMod(mm[1], s) || (s.modlar[mm[1]] ? mm[1] : null);
    if (!id) fail(`Gereksinimde bilinmeyen mod: ${mm[1]}`);
    out.push(mm[2] ? { id, tur, min: mm[2] } : { id, tur });
  }
  return out;
}

// ---------- klasor tasima ----------
function moveDir(from, to) {
  if (exists(to)) {
    fs.mkdirSync(BACKUP, { recursive: true });
    const bak = path.join(BACKUP, path.basename(to) + '_' + stamp());
    fs.renameSync(to, bak);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}
// yayindaki mod degisince Release'e doner; yayinda ve degismemisse Yayinlanan Modlar'da durur
function syncFolders(s, by, log) {
  const moved = [];
  for (const m of Object.values(s.modlar)) {
    const hs = m.adimlar || {};
    if (!hs.yayin || m.yayinlanmayacak) continue;
    const loc = locate(m); if (loc.where !== 'release' && loc.where !== 'yayinlanan') continue;
    const h = computeHash(m, loc).hash; if (!h) continue;
    const r = path.join(REL, m.release), p = path.join(PUB, m.release);
    try {
      if (h !== hs.yayin.ozet && loc.where === 'yayinlanan') {
        moveDir(p, r); addLog(s, by, m.id, 'tasindi', 'Güncellendi: Yayınlanan Modlar -> Release'); moved.push(m.id + ' -> Release');
      } else if (h === hs.yayin.ozet && loc.where === 'release') {
        moveDir(r, p); addLog(s, by, m.id, 'tasindi', 'Yayında ve değişmedi: Release -> Yayınlanan Modlar'); moved.push(m.id + ' -> Yayınlanan Modlar');
      }
    } catch (e) { log && log(`UYARI: ${m.id} klasörü taşınamadı (${e.code || e.message}). Klasörde açık bir dosya olabilir.`); }
  }
  return moved;
}

// ---------- komut calistirma ----------
function gameRunning() {
  try { return cp.execSync(`tasklist /FI "IMAGENAME eq ${GAME_EXE}" /NH`, { encoding: 'utf8', windowsHide: true }).toLowerCase().includes(GAME_EXE.toLowerCase()); }
  catch { return false; }
}
function run(cmdline, cwd, onLine) {
  return new Promise(resolve => {
    const ch = cp.spawn('cmd.exe', ['/d', '/s', '/c', `"${cmdline}"`], { cwd, windowsVerbatimArguments: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let all = '', buf = '';
    const feed = d => {
      buf += d.toString('utf8'); const parts = buf.split(/\r?\n/); buf = parts.pop();
      for (const l of parts) { all += l + '\n'; if (l.trim()) onLine(l); }
    };
    ch.stdout.on('data', feed); ch.stderr.on('data', feed);
    ch.on('close', code => { if (buf.trim()) { all += buf; onLine(buf); } resolve({ code, out: all }); });
    ch.on('error', e => { onLine('HATA: ' + e.message); resolve({ code: -1, out: all }); });
  });
}

// ---------- islemler ----------
async function doBuild(id, ctx) {
  const s0 = load(), m = getMod(s0, id);
  if (!m.derleme) fail(`${m.id}: derleme adımı yok (DLL'siz paket).`);
  if (gameRunning()) fail('Oyun açık: DLL kilitli olur. Oyunu kapatıp tekrar dene.');
  const h = computeHash(m).hash;
  const dir = abs(m.kaynak);
  ctx.log(`===== ${m.id} derleniyor =====`);
  let res;
  if (m.derleme === 'csproj') res = await run(`dotnet build "${m.id}.csproj" -c Release -nologo -v q`, dir, ctx.log);
  else res = await run(`"${path.join(dir, 'derle.bat')}" nopause`, dir, ctx.log);
  const ok = res.code === 0 && !/DERLEME BASARISIZ|error CS\d+|Traceback \(most recent|^HATA/im.test(res.out);
  mutate(s => {
    const mm = getMod(s, m.id); mm.adimlar = mm.adimlar || {};
    mm.adimlar.derleme = { ozet: h, zaman: now(), surum: readVersion(mm), basarili: ok, kim: ctx.by };
    if (!ok) mm.sonHata = res.out.split('\n').filter(l => /error|HATA|BASARISIZ/i.test(l)).slice(0, 15).join('\n'); else delete mm.sonHata;
    addLog(s, ctx.by, m.id, 'derle', ok ? 'derlendi' : 'DERLEME HATASI');
  });
  ctx.log(ok ? `${m.id}: derlendi. Oyunda dene, çalışıyorsa "Çalışıyor ✓" işaretle.` : `${m.id}: DERLEME HATASI`);
  return { id: m.id, ok };
}
function doTest(id, ctx, on = true) {
  return mutate(s => {
    const m = getMod(s, id), h = computeHash(m).hash; m.adimlar = m.adimlar || {};
    if (!on) { delete m.adimlar.test; addLog(s, ctx.by, m.id, 'test', 'Çalışıyor işareti kaldırıldı'); return { id: m.id, ok: true, mesaj: 'işaret kaldırıldı' }; }
    if (!h) fail(`${m.id}: kaynak dosyası bulunamadı.`);
    const d = m.adimlar.derleme;
    if (m.derleme && !(d && d.ozet === h && d.basarili)) fail(`${m.id}: son hali derlenmemiş. Önce derle, oyunda dene, sonra işaretle.`);
    m.adimlar.test = { ozet: h, zaman: now(), surum: readVersion(m), kim: ctx.by };
    addLog(s, ctx.by, m.id, 'test', 'Çalışıyor ✓');
    return { id: m.id, ok: true, mesaj: 'Çalışıyor ✓' };
  });
}
async function doPackage(id, ctx, force) {
  const s0 = load(), m = getMod(s0, id), hs = m.adimlar || {};
  if (!m.paket) fail(`${m.id}: paketleme betiği yok.`);
  const loc0 = locate(m), h = computeHash(m, loc0).hash;
  if (!h) fail(`${m.id}: kaynak dosyası bulunamadı.`);
  if (!force && hs.yayin && hs.yayin.ozet === h) { ctx.log(`${m.id}: atlandı, yayında ve değişmedi.`); return { id: m.id, ok: true, atlandi: true }; }
  if (!force && hs.paket && hs.paket.ozet === h && loc0.zip) { ctx.log(`${m.id}: atlandı, son paketten beri değişmedi.`); return { id: m.id, ok: true, atlandi: true }; }
  if (s0.ayarlar.testZorunlu !== false && !(hs.test && hs.test.ozet === h)) fail(`${m.id}: "Çalışıyor ✓" işareti yok. Önce oyunda dene ve işaretle.`);
  if (gameRunning()) fail('Oyun açık: DLL kilitli olur. Oyunu kapatıp tekrar dene.');
  const r = path.join(REL, m.release), p = path.join(PUB, m.release);
  let wasPub = false;
  if (loc0.where === 'yayinlanan') { moveDir(p, r); wasPub = true; ctx.log(`${m.id}: klasör Release'e taşındı.`); }
  const start = Date.now() - 2000;
  const bat = abs(m.paket);
  ctx.log(`===== ${m.id} paketleniyor =====`);
  const res = await run(`"${bat}" nopause`, path.dirname(bat), ctx.log);
  // betik zip'i yanlislikla Yayinlanan Modlar'a yazdiysa (Release klasoru varken) zip'i Release'e al
  if (isDir(r) && isDir(p)) {
    try {
      for (const f of fs.readdirSync(p).filter(x => /\.zip$/i.test(x))) {
        const src = path.join(p, f);
        if (fs.statSync(src).mtimeMs >= start) { fs.copyFileSync(src, path.join(r, f)); fs.unlinkSync(src); ctx.log(`${m.id}: ${f} Yayınlanan Modlar yerine Release'e alındı.`); }
      }
      if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
    } catch (e) { ctx.log(`UYARI: ${m.id} zip'i Release'e alınamadı (${e.code || e.message}).`); }
  }
  const loc = locate(m);
  const fresh = loc.zips.filter(z => z.t >= start);
  const ok = fresh.length > 0 && !/^HATA/im.test(res.out);
  mutate(s => {
    const mm = getMod(s, m.id); mm.adimlar = mm.adimlar || {};
    if (ok) mm.adimlar.paket = { ozet: h, zaman: now(), surum: readVersion(mm), kim: ctx.by, zip: relToGame(fresh[0].f) };
    addLog(s, ctx.by, m.id, 'paketle', ok ? 'paketlendi: ' + relToGame(fresh[0].f) : 'PAKETLEME HATASI');
    if (wasPub) syncFolders(s, ctx.by, ctx.log);
  });
  ctx.log(ok ? `${m.id}: paket hazır -> ${relToGame(fresh[0].f)} (yayın bekliyor)` : `${m.id}: PAKETLEME HATASI (zip oluşmadı)`);
  return { id: m.id, ok };
}
function doPublish(id, ctx, url, title) {
  const mm = /nexusmods\.com\/[^/]+\/mods\/(\d+)/i.exec(url || '') || /^(\d+)$/.exec(String(url || '').trim());
  if (!mm) fail('Nexus URL anlaşılamadı. Örnek: https://www.nexusmods.com/animeshopsimulator/mods/50');
  const nid = Number(mm[1]);
  const res = mutate(s => {
    const m = getMod(s, id), loc = locate(m), h = computeHash(m, loc).hash, hs = m.adimlar = m.adimlar || {};
    if (!loc.zip) fail(`${m.id}: Release'de zip yok. Önce paketle.`);
    const warn = m.paket && hs.paket && hs.paket.ozet !== h ? 'Dikkat: zip kaynaktan eski; yayın, son paketlenen hal olarak kaydedildi.' : null;
    // paket betigi olmayanlar (zip'i elle hazirlanan paketler) icin yayinlanan hal, klasordeki zip'lerin su anki halidir
    if (!m.paket) hs.paket = { ozet: h, zaman: now(), surum: readVersion(m), kim: ctx.by, zip: relToGame(loc.zip) };
    const pubHash = hs.paket ? hs.paket.ozet : h;
    m.nexus = { id: nid, url: nexusUrl(nid), baslik: title || (m.nexus && m.nexus.baslik) || m.ad || m.id };
    hs.yayin = { ozet: pubHash, zaman: now(), surum: (hs.paket && hs.paket.surum) || readVersion(m), kim: ctx.by };
    // "ne degisti" notu bu yayinla birlikte gitti; sonraki guncelleme icin bosalir
    if (m.not && !m.yayinlanmayacak) { hs.yayin.not = m.not; delete m.not; }
    addLog(s, ctx.by, m.id, 'yayin', `Yayınlandı: ${m.nexus.url}`);
    const moved = syncFolders(s, ctx.by, ctx.log);
    const depWarn = (allViews(s).find(x => x.id === m.id).gereksinimler || []).filter(d => d.tur === 'gerekli' && d.sorun).map(d => `Gereksinim ${d.ad}: ${d.sorun}`);
    return { id: m.id, ok: true, nexus: m.nexus, uyari: [warn, ...depWarn].filter(Boolean).join(' · ') || null, tasinan: moved };
  });
  writeReports(ctx);
  return res;
}
function inferMod(folder, opts = {}) {
  const src = path.join(MODDEV, 'Mods', folder);
  if (!isDir(src)) fail(`ModDev\\Mods\\${folder} klasörü yok.`);
  const m = { id: folder, ad: opts.ad || folder, tur: opts.tur || 'mod', kaynak: relToGame(src), release: folder, derleme: null, paket: null, girdiler: [relToGame(src)], haric: [], adimlar: {} };
  if (exists(path.join(src, folder + '.csproj'))) m.derleme = 'csproj'; else if (exists(path.join(src, 'derle.bat'))) m.derleme = 'derle.bat';
  const pb = path.join(src, 'paketle.bat');
  if (exists(pb)) {
    m.paket = relToGame(pb);
    const lines = fs.readFileSync(pb, 'utf8').split(/\r?\n/).filter(l => !/^\s*rem\b/i.test(l));
    for (const l of lines) { const o = /^\s*set\s+OUT=\.\.\\\.\.\\Release\\(.+?)\s*$/i.exec(l); if (o) { m.release = o[1]; break; } }
    const ud = new Set();
    for (const l of lines) {
      const re = /\.\.\\\.\.\\\.\.\\UserData\\([^"%\r\n]+)/gi; let x;
      while ((x = re.exec(l))) ud.add(x[1].trim().replace(/\\+$/, ''));
    }
    const dirs = [...ud].filter(u => !/[*?]/.test(u) && !/\.[a-z0-9]{2,5}$/i.test(u));
    for (const u of ud) {
      if (dirs.includes(u) || !dirs.some(d => u.toLowerCase().startsWith(d.toLowerCase() + '\\'))) m.girdiler.push('UserData/' + slash(u));
    }
  }
  m.girdiler = [...new Set(m.girdiler)];
  return m;
}
function doAdd(folder, ctx, opts = {}) {
  const res = mutate(s => {
    if (s.modlar[folder] || Object.keys(s.modlar).some(k => k.toLowerCase() === folder.toLowerCase())) fail(`${folder} zaten listede.`);
    let m;
    // ModDev\Mods altinda klasoru varsa (tur ne olursa olsun) kaynakli kayit; yoksa sadece Release klasoru olan paket
    if (!isDir(path.join(MODDEV, 'Mods', folder))) {
      m = { id: folder, ad: opts.ad || folder, tur: opts.tur || 'paket', kaynak: null, release: opts.release || folder, derleme: null, paket: opts.paket || null, girdiler: opts.girdiler || [], haric: [], adimlar: {} };
      if (!m.girdiler.length && !locate(m).dir) fail(`${folder}: ne ModDev\\Mods altında kaynağı ne de Release/Yayınlanan Modlar altında klasörü var.`);
    } else m = inferMod(folder, opts);
    if (opts.not) m.not = opts.not;
    s.modlar[m.id] = m;
    addLog(s, ctx.by, m.id, 'ekle', 'Listeye eklendi');
    return view(m, s, { detay: true });
  });
  writeReports(ctx);
  flushCache();
  return res;
}
function doSet(id, ctx, field, value) {
  const allowed = ['ad', 'tur', 'release', 'girdiler', 'haric', 'paket', 'derleme', 'kaynak', 'not', 'yayinlanmayacak', 'nexus', 'topluHaric', 'gereksinimler'];
  if (!allowed.includes(field)) fail(`Bu alan değiştirilemez: ${field}. İzinli: ${allowed.join(', ')}`);
  const res = mutate(s => {
    const m = getMod(s, id);
    let v = value;
    if (['girdiler', 'haric'].includes(field) && typeof v === 'string') v = v.trim().startsWith('[') ? JSON.parse(v) : v.split(';').map(x => x.trim()).filter(Boolean);
    if (field === 'gereksinimler' && typeof v === 'string') v = /^(readme|)$/i.test(v.trim()) ? '' : parseDepText(v, s);
    if (field === 'yayinlanmayacak' || field === 'topluHaric') v = v === true || v === 'true' || v === '1' || v === 'evet';
    if (field === 'nexus' && typeof v === 'string') { const n = /(\d+)\s*$/.exec(v); v = n ? { id: Number(n[1]), url: nexusUrl(Number(n[1])), baslik: (m.nexus && m.nexus.baslik) || m.ad } : null; }
    if (v === '' || v === null) delete m[field]; else m[field] = v;
    addLog(s, ctx.by, m.id, 'ayar', `${field} değişti`);
    return view(m, s, { detay: true });
  });
  writeReports(ctx);
  return res;
}
function doRemove(id, ctx) {
  const r = mutate(s => { const m = getMod(s, id); delete s.modlar[m.id]; addLog(s, ctx.by, m.id, 'sil', 'Listeden çıkarıldı (dosyalara dokunulmadı)'); return { id: m.id, ok: true }; });
  writeReports(ctx); return r;
}

// ---------- liste ----------
function scan(ctx = {}) {
  const s = load();
  const moved = ctx.noSync ? [] : syncFolders(s, ctx.by || 'otomatik', ctx.log);
  if (moved.length) save(s);
  const mods = allViews(s).sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
  flushCache();
  if (moved.length) writeReports(ctx);
  return { mods, tasinan: moved, ayarlar: s.ayarlar, oyunAcik: gameRunning(), eklenmemis: unlisted() };
}
function unlisted() {
  const s = load(), have = new Set(Object.keys(s.modlar).map(k => k.toLowerCase()));
  const dirs = fs.readdirSync(path.join(MODDEV, 'Mods'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  return dirs.filter(d => !have.has(d.toLowerCase()));
}

// ---------- raporlar (NEXUS_YAYINLANANLAR.txt, YAYINLANACAKLAR.md) ----------
function writeIfChanged(file, text) {
  const old = exists(file) ? fs.readFileSync(file, 'utf8') : null;
  const norm = t => t.replace(/^(Son kontrol|# Nexus yayın durumu).*$/gm, '');
  if (old !== null && norm(old) === norm(text)) return false;
  if (old !== null) {
    fs.mkdirSync(BACKUP, { recursive: true });
    fs.copyFileSync(file, path.join(BACKUP, path.basename(file, path.extname(file)) + '_' + stamp() + path.extname(file)));
    // en fazla 30 yedek kalsin
    const pre = path.basename(file, path.extname(file)) + '_';
    const olds = fs.readdirSync(BACKUP).filter(f => f.startsWith(pre)).sort();
    for (const f of olds.slice(0, Math.max(0, olds.length - 30))) fs.unlinkSync(path.join(BACKUP, f));
  }
  fs.writeFileSync(file, text, 'utf8');
  return true;
}
const cell = t => String(t || '').replace(/\|/g, '/').replace(/\r?\n/g, ' ');
function writeReports(ctx = {}) {
  const s = load(), all = Object.values(s.modlar).map(m => ({ m, v: view(m, s) })).sort((a, b) => a.v.ad.localeCompare(b.v.ad, 'tr'));
  flushCache();
  const pub = all.filter(x => x.m.adimlar && x.m.adimlar.yayin && !x.m.yayinlanmayacak);
  const zipCell = v => {
    if (!v.zip) return 'yok';
    if (v.durum === 'yayin_bekliyor' || v.durum === 'yayinda') return `hazır (${trTime(v.zipZamani)})`;
    return `ESKİ: zip ${trTime(v.zipZamani)}, kaynak ${trTime(v.kaynakZamani)}`;
  };
  const folderCol = x => x.m.release !== x.m.id ? `${x.m.id} (${x.v.yer === 'yayinlanan' ? 'Yayınlanan Modlar' : 'Release'}\\${x.m.release})` : x.m.id;

  // NEXUS_YAYINLANANLAR.txt
  let header = '';
  if (exists(NEXUS_TXT)) {
    const t = fs.readFileSync(NEXUS_TXT, 'utf8'), i = t.search(/^YAYINDA \(/m);
    header = i > 0 ? t.slice(0, i) : '';
  }
  if (!header) header = `NEXUS MODS - YAYINLANAN MODLARIMIZ (${AUTHOR})\nOyun: Anime Shop Simulator (nexusmods.com/${NEXUS_GAME})\nProfil: ${NEXUS_PROFILE}\nSon kontrol: x\n\nBiçim: Nexus ID | ModDev klasörü | Nexus başlığı\nPaketler: x\n\n`;
  const pubFolders = all.filter(x => x.v.yer === 'yayinlanan').map(x => x.m.release);
  header = header.replace(/^Son kontrol:.*$/m, `Son kontrol: ${trDate()}`)
    .replace(/^Yeni mod yayınlayınca.*$/m, 'Bu dosya Mod Yöneticisi (ModDev\\Tools\\ModYoneticisi) tarafından güncellenir; yayınlanan modu oradan işaretleyin.')
    .replace(/^Paketler:.*$/m, `Paketler: güncellenen modlar ModDev\\Release\\<klasör>; yayında ve değişmemiş olanlar ModDev\\Yayınlanan Modlar\\<klasör> (${pubFolders.join(', ')}).`);
  const sorted = [...pub].sort((a, b) => (a.m.nexus && a.m.nexus.id || 1e9) - (b.m.nexus && b.m.nexus.id || 1e9));
  let nx = header + `YAYINDA (${pub.length})\n`;
  for (const x of sorted) nx += `${String(x.m.nexus && x.m.nexus.id || '??').padEnd(2)} | ${folderCol(x).padEnd(30)} | ${(x.m.nexus && x.m.nexus.baslik) || x.v.ad}${x.v.guncellendi ? '   [güncellendi: ' + x.v.durumYazi.toLowerCase() + ']' : ''}\n`;
  const waiting = all.filter(x => !(x.m.adimlar && x.m.adimlar.yayin) && !x.m.yayinlanmayacak);
  nx += `\nYAYINLANMAMIŞ - ZIP HAZIR (ModDev\\Release)\n`;
  for (const x of waiting.filter(x => x.v.durum === 'yayin_bekliyor')) nx += `- ${x.m.id}${x.v.surum ? ' ' + x.v.surum : ''}\n`;
  nx += `\nYAYINLANMAMIŞ - HENÜZ HAZIR DEĞİL\n`;
  for (const x of waiting.filter(x => x.v.durum !== 'yayin_bekliyor')) nx += `- ${x.m.id} (${x.v.durumYazi.toLowerCase()})\n`;
  nx += `\nYAYINLANMAYACAK\n`;
  for (const x of all.filter(x => x.m.yayinlanmayacak)) nx += `- ${x.m.id}${x.m.not ? ' (' + x.m.not + ')' : ''}\n`;
  const c1 = writeIfChanged(NEXUS_TXT, nx);

  // YAYINLANACAKLAR.md
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  let md = `# Nexus yayın durumu (${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())})\n\n`;
  md += `Bu dosya Mod Yöneticisi (ModDev\\Tools\\ModYoneticisi) tarafından otomatik yazılır; elle yapılan değişiklik bir sonraki güncellemede kaybolur. Notları uygulamadan girin. Saatler Türkiye saati.\n\n`;
  md += `## 1. Hiç yayınlanmamış (${waiting.length})\n\n| Mod | Sürüm | Durum | Release zip'i | Not |\n|---|---|---|---|---|\n`;
  for (const x of waiting) md += `| ${cell(x.v.ad)} | ${x.v.surum || '-'} | ${x.v.durumYazi} | ${zipCell(x.v)} | ${cell(x.m.not)} |\n`;
  const upd = pub.filter(x => x.v.guncellendi);
  md += `\n## 2. Yayında ama sonradan güncellenmiş (${upd.length})\n\n| Mod | Nexus | Yayındaki | Şimdiki | Durum | Release zip'i | Not |\n|---|---|---|---|---|---|---|\n`;
  for (const x of upd) md += `| ${cell(x.v.ad)} | ${x.m.nexus && x.m.nexus.id || '??'} | ${x.v.yayindakiSurum || '?'} | ${x.v.surum || '-'} | ${x.v.durumYazi} | ${zipCell(x.v)} | ${cell(x.m.not)} |\n`;
  const same = pub.filter(x => !x.v.guncellendi);
  md += `\n## 3. Yayında ve güncel (${same.length})\n\n${same.map(x => `${x.v.ad}${x.v.surum ? ' ' + x.v.surum : ''}`).join(', ') || '-'}\n`;
  const skip = all.filter(x => x.m.yayinlanmayacak);
  md += `\n## 4. Yayınlanmayacak (${skip.length})\n\n${skip.map(x => `${x.v.ad}${x.m.not ? ' (' + x.m.not + ')' : ''}`).join(', ') || '-'}\n`;
  const c2 = writeIfChanged(PLAN_MD, md);
  if ((c1 || c2) && ctx.log) ctx.log('Listeler güncellendi: ' + [c1 && 'NEXUS_YAYINLANANLAR.txt', c2 && 'YAYINLANACAKLAR.md'].filter(Boolean).join(', '));
  return { nexus: c1, plan: c2 };
}

// ---------- tek giris noktasi ----------
// uzun islemler (derle, paketle) sirayla calisir; ctx = { by, log(line) }
const LONG = new Set(['derle', 'paketle']);
async function exec(cmd, a = {}, ctx = {}) {
  ctx.by = ctx.by || 'Claude'; ctx.log = ctx.log || (() => { });
  const s = load();
  const ids = list => (Array.isArray(list) ? list : list ? [list] : []);
  switch (cmd) {
    case 'liste': return scan(ctx);
    case 'durum': { const m = getMod(s, a.id); const v = view(m, s, { detay: true }); const d = allViews(s).find(x => x.id === m.id); v.gereksinimler = d.gereksinimler; v.bagimlilar = d.bagimlilar; v.gereksinimElle = d.gereksinimElle; v.sonHata = m.sonHata || null; return v; }
    case 'eklenmemis': return unlisted();
    case 'ekle': return doAdd(a.klasor || a.id, ctx, a);
    case 'derle': {
      let list = ids(a.ids);
      if (a.degisenler || a.tumu) list = scan({ ...ctx, noSync: true }).mods.filter(v => v.toplu && v.yapilabilir.derle && (a.tumu || ['derlenecek', 'yeni', 'derleme_hatasi'].includes(v.durum))).map(v => v.id);
      if (!list.length) { ctx.log('Derlenecek mod yok.'); return { sonuc: [] }; }
      const out = []; for (const id of list) { try { out.push(await doBuild(id, ctx)); } catch (e) { ctx.log(`${id}: ${e.message}`); out.push({ id, ok: false, hata: e.message }); if (/Oyun açık/.test(e.message)) break; } }
      return { sonuc: out };
    }
    case 'toplu': return { sonuc: ids(a.ids).map(id => (doSet(id, ctx, 'topluHaric', a.dahil ? '' : true), { id, ok: true, mesaj: a.dahil ? 'toplu işleme dahil' : 'toplu işlemden çıkarıldı' })) };
    case 'gereksinim': return doSet(a.id, ctx, 'gereksinimler', a.metin || '');
    case 'ac': {
      // Windows Gezgini'nde paket (Release / Yayinlanan Modlar) ya da kaynak klasorunu acar
      const m = getMod(s, a.id);
      const dir = a.hedef === 'kaynak' ? (m.kaynak && abs(m.kaynak)) : locate(m).dir;
      if (!dir || !isDir(dir)) fail(`${m.id}: ${a.hedef === 'kaynak' ? 'kaynak' : 'paket'} klasörü yok.`);
      cp.spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
      return { id: m.id, ok: true, klasor: relToGame(dir) };
    }
    case 'calisiyor': return { sonuc: ids(a.ids).map(id => doTest(id, ctx, true)) };
    case 'calismiyor': return { sonuc: ids(a.ids).map(id => doTest(id, ctx, false)) };
    case 'paketle': {
      let list = ids(a.ids);
      if (a.hazirlar || a.tumu) list = scan({ ...ctx, noSync: true }).mods.filter(v => v.toplu && v.yapilabilir.paketle).map(v => v.id);
      if (!list.length) { ctx.log('Paketlenecek mod yok (paketleme "Çalışıyor ✓" işareti olan ve değişen modlar içindir).'); return { sonuc: [] }; }
      const out = []; for (const id of list) { try { out.push(await doPackage(id, ctx, !!a.zorla)); } catch (e) { ctx.log(`${id}: ${e.message}`); out.push({ id, ok: false, hata: e.message }); if (/Oyun açık/.test(e.message)) break; } }
      writeReports(ctx);
      return { sonuc: out };
    }
    case 'yayinlandi': return doPublish(a.id, ctx, a.url, a.baslik);
    case 'not': return doSet(a.id, ctx, 'not', a.metin || '');
    case 'yayinlanmayacak': return doSet(a.id, ctx, 'yayinlanmayacak', a.geri ? false : true);
    case 'ayar': return doSet(a.id, ctx, a.alan, a.deger);
    case 'cikar': return doRemove(a.id, ctx);
    case 'rapor': return writeReports(ctx);
    case 'gecmis': return s.gecmis.slice(-(a.n || 30));
    default: fail(`Bilinmeyen komut: ${cmd}`);
  }
}

module.exports = { exec, LONG, scan, load, save, mutate, view, locate, computeHash, inferMod, writeReports, flushCache, readVersion, syncFolders, addLog, gameRunning, nexusUrl, trTime, STAGES, PORT, paths: { TOOL, MODDEV, GAME, FILES, STATE, REL, PUB, NEXUS_TXT, PLAN_MD } };
