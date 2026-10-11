'use strict';
// Mod Yoneticisi web sunucusu: http://localhost:5170 (sadece bu bilgisayar)
const http = require('http');
const fs = require('fs');
const path = require('path');
const core = require('./core');
const PORT = core.PORT;

const jobs = new Map(); // id -> { id, baslik, satirlar[], bitti, sonuc, hata }
const queue = [];
let running = null, nextId = 1;
const glog = []; let gseq = 0; // ortak gunluk (sayfanin alt paneli)
function gpush(l) { glog.push({ n: ++gseq, t: Date.now(), l }); if (glog.length > 3000) glog.splice(0, glog.length - 3000); }

function title(cmd, a) {
  const what = a.degisenler ? 'değişenler' : a.hazirlar ? 'hazırlar' : (a.ids || []).join(', ');
  return `${cmd === 'derle' ? 'Derle' : 'Paketle'}: ${what}${a.zorla ? ' (zorla)' : ''}`;
}
function enqueue(cmd, a, by) {
  const j = { id: nextId++, cmd, a, by, baslik: title(cmd, a), satirlar: [], bitti: false };
  jobs.set(j.id, j); queue.push(j);
  gpush(`[sırada] ${j.baslik} (${by})`);
  pump();
  return j;
}
async function pump() {
  if (running || !queue.length) return;
  running = queue.shift();
  const j = running;
  gpush(`▶ ${j.baslik} (${j.by})`);
  try {
    j.sonuc = await core.exec(j.cmd, j.a, { by: j.by, log: l => { j.satirlar.push(l); gpush(l); } });
  } catch (e) { j.hata = e.message; j.satirlar.push('HATA: ' + e.message); gpush('HATA: ' + e.message); }
  j.bitti = true; gpush(`■ bitti: ${j.baslik}`);
  running = null;
  // eski isleri temizle
  for (const [id, x] of jobs) if (x.bitti && id < j.id - 50) jobs.delete(id);
  pump();
}

function send(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length, 'cache-control': 'no-store' });
  res.end(b);
}
function body(req) {
  return new Promise(r => { let b = ''; req.setEncoding('utf8'); req.on('data', d => b += d); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      const b = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(b);
    }
    if (u.pathname === '/api/ping') return send(res, 200, { app: 'ModYoneticisi', ok: true });
    if (req.method === 'POST' && u.pathname === '/api/run') {
      const { cmd, args = {}, by = 'Mustafa' } = await body(req);
      if (core.LONG.has(cmd)) { const j = enqueue(cmd, args, by); return send(res, 200, { is: j.id }); }
      try {
        const sonuc = await core.exec(cmd, args, { by, log: gpush });
        if (!['liste', 'durum', 'gecmis', 'eklenmemis', 'ac'].includes(cmd)) gpush(`${by}: ${cmd} ${args.id || (args.ids || []).join(', ') || args.klasor || ''} - tamam`);
        return send(res, 200, { sonuc });
      } catch (e) { if (!e.user) console.error(e); return send(res, 200, { hata: e.message }); }
    }
    let m;
    if (req.method === 'GET' && (m = /^\/api\/is\/(\d+)$/.exec(u.pathname))) {
      const j = jobs.get(Number(m[1])); if (!j) return send(res, 404, { hata: 'iş bulunamadı' });
      const since = Number(u.searchParams.get('since')) || 0;
      return send(res, 200, { satirlar: j.satirlar.slice(since), son: j.satirlar.length, bitti: j.bitti, sonuc: j.sonuc, hata: j.hata });
    }
    if (req.method === 'GET' && u.pathname === '/api/gunluk') {
      const since = Number(u.searchParams.get('since')) || 0;
      return send(res, 200, { satirlar: glog.filter(x => x.n > since), son: gseq, aktif: running ? running.baslik : null, kuyruk: queue.map(q => q.baslik) });
    }
    send(res, 404, { hata: 'yok' });
  } catch (e) { console.error(e); send(res, 500, { hata: e.message }); }
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log(`Mod Yöneticisi zaten açık: http://localhost:${PORT}`); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mod Yöneticisi açık: http://localhost:${PORT}  (kapatmak için bu pencereyi kapatın)`);
  gpush('Sunucu açıldı.');
});
