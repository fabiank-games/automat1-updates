// Automat1-Updater: holt latest.json vom Update-Ort (GitHub), prüft die Unterschrift (Ed25519)
// und ersetzt Spiel (index.html) und Programmteile (main.js, preload.js, updater.js) im Programmordner.
// Gleiche Datei-URL des Spiels → Spielstände (localStorage) bleiben erhalten.
// Ohne Electron testbar: run(appDir, { fetch, log }).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SHELL_FILES = ['main.js', 'preload.js', 'updater.js'];

function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0), pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; } }

// latest.json = { p: "<Text der Nutzdaten>", sig: "<base64>" } – unterschrieben wird genau der Text p
function verify(latest, pubPem) {
  if (!latest || typeof latest.p !== 'string' || typeof latest.sig !== 'string') throw new Error('Update-Datei unvollständig');
  const ok = crypto.verify(null, Buffer.from(latest.p, 'utf8'), crypto.createPublicKey(pubPem), Buffer.from(latest.sig, 'base64'));
  if (!ok) throw new Error('Unterschrift ungültig – Update abgelehnt');
  const p = JSON.parse(latest.p);
  if (p.app !== 'automat1') throw new Error('Falsches Programm');
  return p;
}
function sign(payloadObj, privPem) {
  const p = JSON.stringify(payloadObj);
  return { p, sig: crypto.sign(null, Buffer.from(p, 'utf8'), crypto.createPrivateKey(privPem)).toString('base64') };
}

async function getBuf(fetchFn, url, timeoutMs, onProgress) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchFn(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' bei ' + url);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !r.body.getReader || !onProgress) return Buffer.from(await r.arrayBuffer());
    const rd = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(Buffer.from(value)); got += value.length; onProgress(got, total); }
    return Buffer.concat(parts);
  } finally { clearTimeout(t); }
}

// Datei sicher ersetzen: erst .neu schreiben, alte als .bak behalten, dann umbenennen
function replaceFile(dest, buf) {
  const tmp = dest + '.neu'; fs.writeFileSync(tmp, buf);
  if (fs.existsSync(dest)) { try { fs.copyFileSync(dest, dest + '.bak'); } catch (e) {} }
  fs.renameSync(tmp, dest);
}

/**
 * Prüft und installiert Updates.
 * @returns {Promise<{state:'aktuell'|'aktualisiert'|'offline'|'aus'|'fehler', version, notes, shell:boolean, why?}>}
 */
async function run(appDir, opt = {}) {
  const log = opt.log || (() => {}), status = opt.status || (() => {}), fetchFn = opt.fetch || globalThis.fetch;
  const cfg = readJson(path.join(appDir, 'update.json'), null), ver = readJson(path.join(appDir, 'version.json'), { game: '0', shell: '0' });
  if (!cfg || !cfg.feed || !cfg.pub) return { state: 'aus', version: ver.game, notes: [] };
  const feed = cfg.feed.endsWith('/') ? cfg.feed : cfg.feed + '/';
  let p;
  try {
    status('Suche Updates …');
    const latest = JSON.parse((await getBuf(fetchFn, feed + 'latest.json', opt.checkTimeout || 6000)).toString('utf8'));
    p = verify(latest, cfg.pub);
  } catch (e) { log('Update-Prüfung: ' + e.message); return { state: /Unterschrift|Falsches/.test(e.message) ? 'fehler' : 'offline', version: ver.game, notes: [], why: e.message }; }
  const res = { state: 'aktuell', version: ver.game, notes: p.notes || [], shell: false, latest: p.version };
  try {
    // Spiel
    if (p.game && cmpVer(p.version, ver.game) > 0) {
      status(`Lade Version ${p.version} …`, 0);
      const buf = await getBuf(fetchFn, feed + p.game.file, opt.dlTimeout || 180000, (g, t) => status(`Lade Version ${p.version} …`, t ? g / t : 0));
      if (sha256(buf) !== p.game.sha256 || (p.game.size && buf.length !== p.game.size)) throw new Error('Spieldatei beschädigt (Prüfsumme)');
      replaceFile(path.join(appDir, 'index.html'), buf);
      ver.game = p.version; res.state = 'aktualisiert'; res.version = p.version;
    }
    // Programmteile (selten) – erst alle laden + prüfen, dann ersetzen
    if (p.shell && cmpVer(p.shell.version, ver.shell) > 0) {
      status('Lade Programm-Update …');
      const got = [];
      for (const f of p.shell.files || []) {
        if (!SHELL_FILES.includes(f.name)) throw new Error('Unerwartete Datei im Update: ' + f.name);
        const buf = await getBuf(fetchFn, feed + f.file, 30000);
        if (sha256(buf) !== f.sha256) throw new Error('Programmdatei beschädigt: ' + f.name);
        got.push([f.name, buf]);
      }
      for (const [n, buf] of got) replaceFile(path.join(appDir, n), buf);
      ver.shell = p.shell.version; res.shell = true; res.state = 'aktualisiert';
    }
    fs.writeFileSync(path.join(appDir, 'version.json'), JSON.stringify(ver, null, 2));
  } catch (e) { log('Update fehlgeschlagen: ' + e.message); res.state = 'fehler'; res.why = e.message; }
  return res;
}

module.exports = { run, verify, sign, cmpVer, sha256, SHELL_FILES };
