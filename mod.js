#!/usr/bin/env node
'use strict';
// Mod Yoneticisi komut satiri. Sunucu (Baslat.bat) aciksa isleri ona yollar, kapaliysa kendisi yapar.
// Kullanim: node mod.js yardim
const http = require('http');
const PORT = (() => { try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'config.json'), 'utf8')).port || 5170; } catch { return 5170; } })();

const HELP = `Mod Yöneticisi - komut satırı

  node mod.js liste [--durum <durum>] [--json]   tüm modlar ve durumları
  node mod.js durum <mod> [--json]                tek modun ayrıntısı (girdiler, adımlar, son hata)
  node mod.js eklenmemis                          ModDev\\Mods altında olup listede olmayanlar
  node mod.js ekle <klasör> [--ad "Görünen ad"] [--tur mod|paket|arac] [--not "..."]
  node mod.js derle <mod> [<mod> ...] | --tumu | --degisenler   (--tumu/--degisenler sadece toplu işleme dahil olanlar)
  node mod.js calisiyor <mod> [...]               "Çalışıyor ✓" (sadece kullanıcı oyunda denediyse!)
  node mod.js calismiyor <mod> [...]              işareti kaldır
  node mod.js paketle <mod> [...] | --tumu [--zorla]          (--tumu: dahil olan, test edilmiş ve değişenler)
  node mod.js toplu <mod> [...] --haric | --dahil            toplu derle/paketle'ye girsin mi
  node mod.js gereksinim <mod> "ModMarket>=1.4.0; ?ModSettings; !PlayAsMint"   (? önerilen, ! birlikte olmaz; 'readme' = README'den oku)
  node mod.js yayinlandi <mod> <nexus-url> [--baslik "Nexus başlığı"]
  node mod.js not <mod> "metin"                   YAYINLANACAKLAR.md'deki not / ne değişti
  node mod.js yayinlanmayacak <mod> [--geri]
  node mod.js ayar <mod> <alan> <değer>           alan: ad, release, girdiler, haric, paket, derleme, nexus
  node mod.js cikar <mod>                         listeden çıkar (dosyalara dokunmaz)
  node mod.js rapor                               NEXUS_YAYINLANANLAR.txt ve YAYINLANACAKLAR.md'yi yeniden yaz
  node mod.js gecmis [n]
  --kim <ad>   işlemi yapanın adı (varsayılan Claude)

Durumlar: yeni, derlenecek, derleme_hatasi, test_bekliyor, paketlenecek, yayin_bekliyor, yayinda, yayinlanmayacak`;

function parse(argv) {
  const pos = [], fl = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx !== undefined && !nx.startsWith('--')) { fl[k] = nx; i++; } else fl[k] = true; }
    else pos.push(a);
  }
  return { pos, fl };
}
function build(cmd, pos, fl) {
  const a = {};
  switch (cmd) {
    case 'durum': case 'cikar': case 'yayinlanmayacak': a.id = pos[0]; a.geri = !!fl.geri; break;
    case 'ekle': a.klasor = pos[0]; if (fl.ad) a.ad = fl.ad; if (fl.tur) a.tur = fl.tur; if (fl.not) a.not = fl.not; if (fl.release) a.release = fl.release; break;
    case 'derle': a.ids = pos; a.degisenler = !!fl.degisenler; a.tumu = !!fl.tumu; break;
    case 'toplu': a.ids = pos; a.dahil = !!fl.dahil && !fl.haric; break;
    case 'gereksinim': a.id = pos[0]; a.metin = pos.slice(1).join(' '); break;
    case 'calisiyor': case 'calismiyor': a.ids = pos; break;
    case 'paketle': a.ids = pos; a.hazirlar = !!fl.hazirlar; a.tumu = !!fl.tumu; a.zorla = !!fl.zorla; break;
    case 'yayinlandi': a.id = pos[0]; a.url = pos[1]; if (fl.baslik) a.baslik = fl.baslik; break;
    case 'not': a.id = pos[0]; a.metin = pos.slice(1).join(' '); break;
    case 'ayar': a.id = pos[0]; a.alan = pos[1]; a.deger = pos.slice(2).join(' '); break;
    case 'gecmis': a.n = Number(pos[0]) || 30; break;
  }
  return a;
}
function req(method, p, body) {
  return new Promise((res, rej) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {}, timeout: 3000 }, rs => {
      let b = ''; rs.setEncoding('utf8'); rs.on('data', d => b += d); rs.on('end', () => { try { res(JSON.parse(b)); } catch { rej(new Error('bad json')); } });
    });
    r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout')));
    if (data) r.write(data); r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function viaServer(cmd, a, by) {
  try { const p = await req('GET', '/api/ping'); if (!p || p.app !== 'ModYoneticisi') return null; } catch { return null; }
  const r = await req('POST', '/api/run', { cmd, args: a, by });
  if (r.hata) { const e = new Error(r.hata); e.user = true; throw e; }
  if (!r.is) return r.sonuc;
  // kuyruktaki is: gunlugu akit, bitince sonucu dondur
  let since = 0;
  for (;;) {
    const j = await req('GET', `/api/is/${r.is}?since=${since}`);
    for (const l of j.satirlar) console.log(l);
    since = j.son;
    if (j.bitti) { if (j.hata) { const e = new Error(j.hata); e.user = true; throw e; } return j.sonuc; }
    await sleep(700);
  }
}

const pad = (s, n) => { s = String(s ?? ''); return s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length); };
function printList(r, fl) {
  let mods = r.mods;
  if (fl.durum) mods = mods.filter(m => m.durum === fl.durum || (fl.durum === 'guncellendi' && m.guncellendi));
  console.log(pad('MOD', 30) + pad('SÜRÜM', 9) + pad('DURUM', 26) + pad('YER', 11) + pad('NEXUS', 6) + 'NOT');
  for (const m of mods) {
    const st = m.durumYazi + (m.guncellendi ? ` (yayında ${m.yayindakiSurum})` : '');
    const dep = (m.gereksinimler || []).filter(d => d.sorun && d.tur === 'gerekli').map(d => `⚠ ${d.id}: ${d.sorun}`).join('; ');
    console.log((m.toplu ? ' ' : '-') + pad(m.id, 29) + pad(m.surum || '-', 9) + pad(st, 26) + pad(m.yer === 'yayinlanan' ? 'Yayınlanan' : m.yer || '-', 11) + pad(m.nexus && m.nexus.id || '', 6) + (m.not || '').slice(0, 60) + (dep ? '  ' + dep : ''));
  }
  const cnt = {}; for (const m of r.mods) cnt[m.durumYazi] = (cnt[m.durumYazi] || 0) + 1;
  console.log('\n' + Object.entries(cnt).map(([k, v]) => `${k}: ${v}`).join(' | ') + ` | toplam ${r.mods.length}`);
  if (r.tasinan && r.tasinan.length) console.log('Taşınan klasörler: ' + r.tasinan.join(', '));
  console.log('("-" ile başlayanlar toplu derle/paketle dışında)');
  if (r.eklenmemis && r.eklenmemis.length) console.log('Listede olmayan ModDev/Mods klasörleri: ' + r.eklenmemis.join(', ') + "  ('node mod.js ekle <klasör>')");
  if (r.oyunAcik) console.log('Not: oyun açık (derle/paketle çalışmaz).');
}

(async () => {
  const { pos, fl } = parse(process.argv.slice(2));
  const cmd = pos.shift();
  if (!cmd || cmd === 'yardim' || cmd === 'help' || fl.help) { console.log(HELP); return; }
  const a = build(cmd, pos, fl), by = typeof fl.kim === 'string' ? fl.kim : 'Claude';
  let out;
  try {
    out = await viaServer(cmd, a, by);
    if (out === null) {
      const core = require('./core');
      out = await core.exec(cmd, a, { by, log: l => console.log(l) });
    }
  } catch (e) {
    console.error('HATA: ' + e.message); if (!e.user) console.error(e.stack); process.exitCode = 1; return;
  }
  if (fl.json) { console.log(JSON.stringify(out, null, 2)); return; }
  if (cmd === 'liste') return printList(out, fl);
  if (cmd === 'eklenmemis') { console.log(out.length ? out.join('\n') : 'Hepsi listede.'); return; }
  if (cmd === 'gecmis') { for (const g of out) console.log(`${new Date(g.zaman).toLocaleString('tr-TR')}  ${pad(g.kim, 8)} ${pad(g.mod, 26)} ${pad(g.islem, 10)} ${g.mesaj}`); return; }
  if (out && out.sonuc) { for (const r of out.sonuc) console.log(`${r.id}: ${r.atlandi ? 'atlandı' : r.ok ? 'tamam' : 'HATA'}${r.hata ? ' - ' + r.hata : ''}${r.mesaj ? ' - ' + r.mesaj : ''}`); if (out.sonuc.some(r => !r.ok)) process.exitCode = 1; return; }
  if (cmd === 'durum' && out.gereksinimler) {
    const tr = { gerekli: 'gerekli', onerilen: 'önerilen', cakisir: 'birlikte olmaz' };
    console.log(`${out.ad} (${out.id}) ${out.surum || ''} - ${out.durumYazi}${out.guncellendi ? ' (yayında ' + out.yayindakiSurum + ')' : ''}${out.toplu ? '' : ' - toplu işlem dışı'}`);
    console.log('Gereksinimler' + (out.gereksinimElle ? ' (elle)' : ' (README)') + ':');
    for (const d of out.gereksinimler) console.log(`  ${tr[d.tur]}: ${d.ad}${d.min ? ' >= ' + d.min : ''}${d.sorun ? '  ⚠ ' + d.sorun : ''}`);
    if (!out.gereksinimler.length) console.log('  -');
    console.log('Buna ihtiyaç duyanlar: ' + (out.bagimlilar.map(b => b.ad + (b.tur === 'gerekli' ? '' : ' (' + tr[b.tur] + ')')).join(', ') || '-'));
    if (out.sonHata) console.log('Son hata:\n' + out.sonHata);
    if (!fl.json) return;
  }
  console.log(JSON.stringify(out, null, 2));
})();
