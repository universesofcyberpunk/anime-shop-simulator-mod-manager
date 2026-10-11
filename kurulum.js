'use strict';
// Ilk kurulum: bugunku ModDev durumundan mod_durum.json olusturur. Bir kez calistirilir.
// node kurulum.js --dene   (kaydetmeden ozet)      node kurulum.js --zorla   (var olan dosyanin ustune yaz)
const fs = require('fs');
const path = require('path');
const core = require('./core');
const { MODDEV, GAME, STATE, REL, PUB, NEXUS_TXT, PLAN_MD } = core.paths;
const dry = process.argv.includes('--dene'), force = process.argv.includes('--zorla');
if (fs.existsSync(STATE) && !dry && !force) { console.log('mod_durum.json zaten var. Üstüne yazmak için --zorla.'); process.exit(1); }

const slash = p => p.replace(/\\/g, '/');
const rel = p => slash(path.relative(GAME, p));
const s = { surum: 1, ayarlar: { testZorunlu: true }, modlar: {}, gecmis: [] };

// 1) ModDev\Mods altindaki kaynaklar
for (const d of fs.readdirSync(path.join(MODDEV, 'Mods'), { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  s.modlar[d.name] = core.inferMod(d.name);
}
const M = s.modlar;
if (M.HitchFinder) { M.HitchFinder.yayinlanmayacak = true; M.HitchFinder.not = 'iç test aracı'; }
for (const k of ['CardStudio', 'DakimakuraStudio', 'MangaStudio']) if (M[k]) {
  M[k].haric = ['DefaultImages', 'Packs', '_originals'].map(x => `ModDev/Mods/${k}/${x}`);
  M[k].not = 'sadece yükleyici (resimler ayrı paketlerde)';
}
if (M.EmployeeSkinPack) { M.EmployeeSkinPack.girdiler = ['ModDev/Mods/EmployeeSkinPack']; M.EmployeeSkinPack.haric = ['ModDev/Mods/EmployeeSkinPack/tools/build_report.json', 'ModDev/Mods/EmployeeSkinPack/tools/preview']; M.EmployeeSkinPack.tur = 'paket'; }
if (M.FigureShopNewFigures) {
  const figs = fs.readFileSync(path.join(MODDEV, 'Mods', 'FigureShopNewFigures', 'figures.txt'), 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  M.FigureShopNewFigures.girdiler = ['ModDev/Mods/FigureShopNewFigures', ...figs.map(f => 'UserData/FigureShop/' + f)];
  M.FigureShopNewFigures.tur = 'paket'; M.FigureShopNewFigures.ad = 'Fabianens Figure Shop - New Figures';
}
if (M.FigureShop) M.FigureShop.not = 'Figure Maker paketleri (figure.json); paket kendi lisansını getirebilir';

// 2) kaynagi Mods altinda olmayan paketler (resim paketleri, arac, preset)
const pack = (id, o) => { s.modlar[id] = Object.assign({ id, ad: id, tur: 'paket', kaynak: null, release: id, derleme: null, paket: null, girdiler: [], haric: [], adimlar: {} }, o); };
pack('CardStudio_DefaultCards', { paket: 'ModDev/Mods/CardStudio/paketle_resimler.bat', girdiler: ['ModDev/Mods/CardStudio/DefaultImages/icon_card*'], not: 'varsayılan kartlar' });
pack('CardStudio_Frames', { paket: 'ModDev/Mods/CardStudio/paketle_resimler.bat', girdiler: ['ModDev/Mods/CardStudio/DefaultImages/Borders', 'ModDev/Mods/CardStudio/DefaultImages/Labels', 'ModDev/Mods/CardStudio/DefaultImages/card_cover.png'], not: 'kart çerçeveleri' });
pack('DakimakuraStudio_Pack', { paket: 'ModDev/Mods/DakimakuraStudio/paketle_resimler.bat', girdiler: ['ModDev/Mods/DakimakuraStudio/DefaultImages'], not: 'yastık görselleri' });
pack('MangaStudio_Pack', { paket: 'ModDev/Mods/MangaStudio/paketle_resimler.bat', girdiler: ['ModDev/Mods/MangaStudio/DefaultImages'], not: 'manga kapakları' });
pack('MangaStudio_Pack2', { paket: 'ModDev/Mods/MangaStudio/paketle_resimler.bat', girdiler: ['ModDev/Mods/MangaStudio/Packs/MangaStudio_Pack2'], not: 'manga kapakları 2' });
pack('CardStudio_CardPacks', { ad: 'CardStudio_CardPack1-5', not: 'kart görselleri (5 zip, elle hazırlanır)' });
pack('FigureMaker', { ad: 'Figure Maker', tur: 'arac', kaynak: 'ModDev/Tools/FigureMaker', girdiler: ['ModDev/Tools/FigureMaker/figuremaker.py', 'ModDev/Tools/FigureMaker/FigureMaker.bat', 'ModDev/Tools/FigureMaker/README_FigureMaker.txt', 'ModDev/Tools/FigureMaker/templates', 'ModDev/Tools/FigureMaker/tools'], not: 'araç: GLB/GLTF modelden FigureShop figür paketi' });
pack('FBS_Alma_Floria', { ad: 'Alma Floria (FBS preset)' });
const known = new Set(Object.values(s.modlar).map(m => m.release.toLowerCase()));
for (const base of [REL, PUB]) for (const d of fs.readdirSync(base, { withFileTypes: true })) {
  if (d.isDirectory() && !known.has(d.name.toLowerCase())) { pack(d.name, {}); known.add(d.name.toLowerCase()); console.log('Elle eklenen paket: ' + d.name); }
}

// 3) Nexus listesi
const byRelease = {}; for (const m of Object.values(s.modlar)) { byRelease[m.id.toLowerCase()] = m; byRelease[m.release.toLowerCase()] = m; }
const nx = fs.readFileSync(NEXUS_TXT, 'utf8').split(/\r?\n/);
let inPub = false;
for (const l of nx) {
  if (/^YAYINDA \(/.test(l)) { inPub = true; continue; }
  if (inPub && !l.trim()) break;
  const x = /^\s*(\d+|\?\?)\s*\|\s*(\S+)[^|]*\|\s*(.+?)\s*$/.exec(l); if (!inPub || !x) continue;
  const m = byRelease[x[2].toLowerCase()]; if (!m) { console.log('Nexus satırı eşleşmedi: ' + l); continue; }
  const id = x[1] === '??' ? null : Number(x[1]);
  m.nexus = { id, url: core.nexusUrl(id), baslik: x[3].replace(/\s*\(\d\d\.\d\d\.\d{4}\)\s*$/, '') };
}

// 4) YAYINLANACAKLAR.md bolum 2 notlari ("ne degisti")
const md = fs.readFileSync(PLAN_MD, 'utf8');
const sec2 = (md.split(/^## 2\./m)[1] || '').split(/^## /m)[0];
const alias = { 'fps doctor': 'FPSDoctor', 'fbs (fbsbody)': 'FBSBody' };
for (const l of sec2.split(/\r?\n/)) {
  const c = l.split('|').map(x => x.trim()); if (c.length < 5 || c[1] === 'Mod' || /^-+$/.test(c[1])) continue;
  let names = [c[1]];
  if (/^GlamourStatuePack 1, 2, 3/.test(c[1])) names = ['GlamourStatuePack', 'GlamourStatuePack2', 'GlamourStatuePack3'];
  const t = /^Tekli heykeller:\s*(.+)$/.exec(c[1]); if (t) names = t[1].split(',').map(n => n.trim().replace(/\s+/g, '') + 'Statue');
  for (const n of names) { const m = M[alias[n.toLowerCase()] || n] || byRelease[n.toLowerCase()]; if (m && c[3]) m.not = c[3]; }
}

// 5) adimlar: bugunku haller test edildi sayilir; zip kaynaktan yeniyse paketlenmis; Yayinlanan Modlar'dakiler yayinda ve degismemis
const t0 = new Date().toISOString(), rep = { yayinda: [], guncellendi: [], paketEski: [], kaynakYok: [] };
for (const m of Object.values(s.modlar)) {
  const loc = core.locate(m), h = core.computeHash(m, loc), v = core.readVersion(m);
  if (!h.hash) { rep.kaynakYok.push(m.id); continue; }
  const hs = m.adimlar = {};
  if (m.derleme) hs.derleme = { ozet: h.hash, zaman: t0, surum: v, basarili: true, kim: 'kurulum' };
  hs.test = { ozet: h.hash, zaman: t0, surum: v, kim: 'kurulum' };
  if (loc.zip && new Date(loc.zipTime).getTime() >= new Date(h.newest).getTime() - 1000) hs.paket = { ozet: h.hash, zaman: loc.zipTime, surum: v, kim: 'kurulum', zip: rel(loc.zip) };
  else if (loc.zip) rep.paketEski.push(`${m.id} (zip ${core.trTime(loc.zipTime)}, kaynak ${core.trTime(h.newest)})`);
  if (m.nexus) {
    if (loc.where === 'yayinlanan') { hs.yayin = { ozet: h.hash, zaman: t0, surum: v, kim: 'kurulum' }; rep.yayinda.push(m.id); }
    else { hs.yayin = { ozet: 'kurulum-oncesi', zaman: t0, surum: '?', kim: 'kurulum' }; rep.guncellendi.push(m.id); }
  }
}
core.flushCache();
s.gecmis.push({ zaman: t0, kim: 'kurulum', mod: '-', islem: 'kurulum', mesaj: `${Object.keys(s.modlar).length} mod ile başlangıç listesi kuruldu` });
console.log(`Toplam ${Object.keys(s.modlar).length} kayıt.`);
console.log(`Yayında ve güncel (${rep.yayinda.length}): ${rep.yayinda.join(', ')}`);
console.log(`Yayında, güncellendi (${rep.guncellendi.length}): ${rep.guncellendi.join(', ')}`);
console.log(`Zip kaynaktan eski (${rep.paketEski.length}): ${rep.paketEski.join('; ')}`);
console.log(`Kaynak bulunamadı (${rep.kaynakYok.length}): ${rep.kaynakYok.join(', ')}`);
if (dry) { console.log('(--dene: kaydedilmedi)'); process.exit(0); }
core.save(s);
console.log('Kaydedildi: ' + STATE);
