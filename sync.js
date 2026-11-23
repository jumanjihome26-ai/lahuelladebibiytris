/* =====================================================================
   sync.js · La Huella de Bibi & Tris · V2 · SINCRONIZACIÓN CON DROPBOX
   Misma filosofía que El Compendio del Baluarte V8:
   - Los datos se guardan siempre en local (carpeta en Windows, navegador en móvil/iPad).
   - Dropbox (carpeta propia de la app) es el punto de encuentro: sin conexión todo funciona
     y se sincroniza al recuperarla.
   - Fusión por elemento: gana el cambio MÁS RECIENTE de cada peludo, peso, visita, compra o gasto.
   - Los borrados se recuerdan 90 días para que lleguen a los demás dispositivos.
   ===================================================================== */
(function (root) {
  "use strict";
  const EPOCH = "1970-01-01T00:00:00.000Z", TOMB_DAYS = 90;
  const APP_KEY = "d9qdjwitsfvtlko";                    // identificador público de la app de Dropbox (la misma del Compendio)
  const FILE_PATH = "/Huella-de-Bibi-y-Tris.json";
  const norm = v => String(v || "").trim().normalize("NFC").toLocaleLowerCase("es");
  const clone = o => JSON.parse(JSON.stringify(o));
  let nowFn = () => new Date().toISOString();
  const nowIso = () => nowFn();

  /* ---------- PARTE 1 · NÚCLEO (sin red) ---------- */
  const hPet = p => JSON.stringify([p.nombre, p.nac, p.alias, !!p.perro, !!p.gato, !!p.macho, !!p.hembra, p.foto || "", p.caracter, p.gustos, p.alergias, p.proxima, !!p.conf]);
  const hVis = v => JSON.stringify([v.f, v.m, v.n, v.c]);
  const hPes = w => JSON.stringify([w.f, w.kg]);
  const hPie = x => JSON.stringify([x.f, x.m, x.q, x.k, x.p]);
  const hGas = x => JSON.stringify([x.f, x.m, x.p]);
  const isSeed = p => (p.updatedAt || EPOCH) === EPOCH && !p.foto && !(p.visitas || []).length && !(p.pesos || []).length && !p.caracter && !p.gustos && !p.alergias && !p.nac && !p.alias;

  function ensureStamps(d) {
    let ch = false;
    if (!Array.isArray(d.deleted)) { d.deleted = []; ch = true; }
    if (!Array.isArray(d.pienso)) { d.pienso = []; ch = true; }
    if (!Array.isArray(d.gastos)) { d.gastos = []; ch = true; }
    const st = x => { if (!x.updatedAt) { x.updatedAt = EPOCH; ch = true; } };
    for (const p of d.pets || []) { st(p); (p.visitas || []).forEach(st); (p.pesos || []).forEach(st); }
    d.pienso.forEach(st); d.gastos.forEach(st);
    if (d.schema !== 2) { d.schema = 2; ch = true; }
    return ch;
  }
  const mapOf = (arr, h) => new Map((arr || []).map(x => [x.id, h(x)]));
  function makeBase(d) {
    const b = { pets: new Map(), pienso: mapOf(d.pienso, hPie), gastos: mapOf(d.gastos, hGas) };
    for (const p of d.pets || []) b.pets.set(p.id, { h: hPet(p), name: norm(p.nombre), vis: mapOf(p.visitas, hVis), pes: mapOf(p.pesos, hPes) });
    return b;
  }
  // Compara con la «foto» anterior: sella lo modificado y anota lo borrado (no hay que tocar el resto del programa).
  function stampChanges(d, base) {
    if (!base) return makeBase(d);
    const now = nowIso(); if (!Array.isArray(d.deleted)) d.deleted = [];
    const T = d.deleted;
    const clr = (type, id) => { for (let i = T.length - 1; i >= 0; i--) if (T[i].type === type && T[i].id === id) T.splice(i, 1); };
    const setT = (type, id, ex) => { clr(type, id); T.push(Object.assign({ type, id, deletedAt: now }, ex || {})); };
    const flat = (arr, map, h, type, extra) => {
      const seen = new Set();
      for (const x of arr || []) { seen.add(x.id); const b = map.get(x.id); if (b === undefined || b !== h(x)) { x.updatedAt = now; if (b === undefined) clr(type, x.id); } }
      for (const id of map.keys()) if (!seen.has(id)) setT(type, id, extra);
    };
    const ids = new Set();
    for (const p of d.pets || []) {
      ids.add(p.id); const b = base.pets.get(p.id);
      if (!b) { p.updatedAt = now; clr("pet", p.id); (p.visitas || []).forEach(v => { v.updatedAt = now; }); (p.pesos || []).forEach(w => { w.updatedAt = now; }); continue; }
      if (hPet(p) !== b.h) p.updatedAt = now;
      flat(p.visitas, b.vis, hVis, "visit", { petId: p.id }); flat(p.pesos, b.pes, hPes, "peso", { petId: p.id });
    }
    for (const [id, b] of base.pets) if (!ids.has(id)) setT("pet", id, { name: b.name });
    flat(d.pienso, base.pienso, hPie, "pienso"); flat(d.gastos, base.gastos, hGas, "gasto");
    return makeBase(d);
  }
  const effTime = p => { let m = p.updatedAt || EPOCH; for (const x of (p.visitas || []).concat(p.pesos || [])) if ((x.updatedAt || EPOCH) > m) m = x.updatedAt; return m; };
  const canon = d => JSON.stringify([d.pets, d.pienso || [], d.gastos || [], (d.deleted || []).slice().sort((a, b) => (a.type + a.id).localeCompare(b.type + b.id))]);

  function mergeData(local, remote) {
    const st = { petsAdded: 0, petsUpdated: 0, petsRemoved: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0 };
    const limit = new Date(Date.now() - TOMB_DAYS * 86400000).toISOString(), tombs = new Map();
    for (const t of [].concat(local.deleted || [], remote.deleted || [])) { const k = t.type + ":" + t.id, o = tombs.get(k); if (!o || t.deletedAt > o.deletedAt) tombs.set(k, t); }
    for (const [k, t] of tombs) if (t.deletedAt < limit) tombs.delete(k);
    const killed = (type, id, time) => { const t = tombs.get(type + ":" + id); return !!t && t.deletedAt > time; };

    function mergeArr(la, ra, type, h, byKey) {
      const rid = new Map(ra.map(x => [x.id, x])), used = new Set(), pair = new Map();
      for (const x of la) { const y = rid.get(x.id); if (y) { pair.set(x, y); used.add(y); } }
      if (byKey) {
        const rk = new Map(); for (const y of ra) if (!used.has(y)) { const k = byKey(y); if (!rk.has(k)) rk.set(k, y); }
        for (const x of la) { if (pair.has(x)) continue; const k = byKey(x), y = rk.get(k); if (y && !used.has(y)) { pair.set(x, y); used.add(y); rk.delete(k); } }
      }
      const mate = new Map([...pair].map(([x, y]) => [y, x])), out = [];
      for (const y of ra) {
        const x = mate.get(y);
        if (x) {
          const w = (y.updatedAt || EPOCH) >= (x.updatedAt || EPOCH) ? y : x;
          if (killed(type, x.id, w.updatedAt || EPOCH) || killed(type, y.id, w.updatedAt || EPOCH)) { st.itemsRemoved++; continue; }
          if (w === y && h(y) !== h(x)) st.itemsUpdated++;
          out.push(Object.assign({}, w, { id: x.id !== y.id ? [x.id, y.id].sort()[0] : x.id }));
        } else if (killed(type, y.id, y.updatedAt || EPOCH)) st.itemsRemoved++; else { out.push(y); st.itemsAdded++; }
      }
      for (const x of la) { if (pair.has(x)) continue; if (killed(type, x.id, x.updatedAt || EPOCH)) st.itemsRemoved++; else out.push(x); }
      return out;
    }

    const L = clone(local.pets || []), R = clone(remote.pets || []);
    const rId = new Map(R.map(p => [p.id, p])), usedR = new Set(), pairs = [];
    for (const l of L) { const r = rId.get(l.id); if (r) { pairs.push([l, r, false]); usedR.add(r); } }
    const paired = new Set(pairs.map(p => p[0])), rName = new Map();
    for (const r of R) if (!usedR.has(r)) { const k = norm(r.nombre); if (k && !rName.has(k)) rName.set(k, r); }
    for (const l of L) { if (paired.has(l)) continue; const k = norm(l.nombre), r = k && rName.get(k); if (r && !usedR.has(r)) { pairs.push([l, r, true]); usedR.add(r); paired.add(l); rName.delete(k); } }
    const merged = [];
    for (const [l, r, byName] of pairs) {
      const rWins = (r.updatedAt || EPOCH) >= (l.updatedAt || EPOCH), w = rWins ? r : l;
      const out = Object.assign({}, w, { id: byName ? [l.id, r.id].sort()[0] : l.id });
      out.visitas = mergeArr(l.visitas || [], r.visitas || [], "visit", hVis, byName ? v => v.f + "|" + norm(v.m) : null);
      out.pesos = mergeArr(l.pesos || [], r.pesos || [], "peso", hPes, byName ? x => x.f + "|" + x.kg : null);
      const eff = effTime(out);
      if (killed("pet", l.id, eff) || killed("pet", r.id, eff)) { st.petsRemoved++; continue; }
      if (tombs.has("pet:" + l.id) || tombs.has("pet:" + r.id)) if (eff > (out.updatedAt || EPOCH)) out.updatedAt = eff;   // editado DESPUÉS del borrado: se conserva
      if (rWins && hPet(r) !== hPet(l)) st.petsUpdated++;
      out.__o = R.indexOf(r); merged.push(out);
    }
    const pruneKids = p => { const k1 = (p.visitas || []).filter(v => !killed("visit", v.id, v.updatedAt || EPOCH)), k2 = (p.pesos || []).filter(v => !killed("peso", v.id, v.updatedAt || EPOCH)); st.itemsRemoved += (p.visitas || []).length + (p.pesos || []).length - k1.length - k2.length; p.visitas = k1; p.pesos = k2; };
    L.forEach((l, i) => { if (paired.has(l)) return; if (R.length && isSeed(l)) return;   // peludo vacío de un dispositivo nuevo: no se duplica
      pruneKids(l); if (killed("pet", l.id, effTime(l))) st.petsRemoved++; else { l.__o = 1e6 + i; merged.push(l); } });
    R.forEach((r, i) => { if (usedR.has(r)) return; pruneKids(r); if (killed("pet", r.id, effTime(r))) { st.petsRemoved++; return; } r.__o = i; merged.push(r); st.petsAdded++; });
    merged.sort((a, b) => a.__o - b.__o); merged.forEach(x => { delete x.__o; });

    const data = { format: "huella-bibi-tris", version: 1, schema: 2, exportedAt: nowIso(), pets: merged,
      pienso: mergeArr(local.pienso || [], remote.pienso || [], "pienso", hPie, null), gastos: mergeArr(local.gastos || [], remote.gastos || [], "gasto", hGas, null), deleted: [...tombs.values()] };
    return { data, stats: st };
  }

  /* ---------- PARTE 2 · DROPBOX ---------- */
  let host = null, auth = null, state = {}, running = null, rerun = false, timer = null, kvdb = null, listeners = [], base = null, pk = null;
  const status = { connected: false, busy: false, error: null, pending: false, lastSyncAt: null, lastResult: null };
  function kvOpen() { return new Promise((res, rej) => { if (kvdb) return res(kvdb); const q = indexedDB.open("HuellaSync", 1); q.onupgradeneeded = () => q.result.createObjectStore("kv"); q.onsuccess = () => { kvdb = q.result; res(kvdb); }; q.onerror = () => rej(q.error); }); }
  async function kvOp(mode, fn) { const db = await kvOpen(); return new Promise((res, rej) => { const tx = db.transaction("kv", mode); let r; try { r = fn(tx.objectStore("kv")); } catch (e) { rej(e); return; } tx.oncomplete = () => res(r ? r.result : undefined); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); }
  const kvGet = k => kvOp("readonly", s => s.get(k)), kvSet = (k, v) => kvOp("readwrite", s => s.put(v, k)), kvDel = k => kvOp("readwrite", s => s.delete(k));
  const saveState = () => kvSet("state", state).catch(() => {});
  const notify = () => listeners.forEach(f => { try { f(status); } catch (e) { /* noop */ } });
  const setStatus = p => { Object.assign(status, p); notify(); };
  const mkErr = (code, message) => Object.assign(new Error(message || code), { code });

  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function getPkce() {   // se genera UNA vez por intento y se guarda: si iOS recarga la app mientras vas a Dropbox, el código sigue valiendo
    if (!pk) { const s = await kvGet("pkce").catch(() => null); if (s && s.url && Date.now() - s.createdAt < 9 * 60000) pk = s; }
    if (!pk || Date.now() - pk.createdAt > 9 * 60000) {
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(48))), challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
      pk = { verifier, challenge, createdAt: Date.now(), url: "https://www.dropbox.com/oauth2/authorize?client_id=" + APP_KEY + "&response_type=code&code_challenge=" + challenge + "&code_challenge_method=S256&token_access_type=offline" };
      await kvSet("pkce", pk);
    }
    return pk;
  }
  async function tokenRequest(params) {
    let res; try { res = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() }); }
    catch (e) { throw mkErr("network", "No se pudo contactar con Dropbox (¿sin conexión?)."); }
    let j = {}; try { j = await res.json(); } catch (e) { /* noop */ }
    if (!res.ok) throw mkErr(j.error === "invalid_grant" ? "invalid_grant" : "auth", j.error_description || j.error || ("Error " + res.status));
    return j;
  }
  const storeTokens = (j, prev) => { auth = { access_token: j.access_token, refresh_token: j.refresh_token || (prev && prev.refresh_token), expires_at: Date.now() + Math.max(60, (j.expires_in || 14400) - 120) * 1000 }; return kvSet("auth", auth); };
  async function connectWithCode(code) {
    const p = await kvGet("pkce"); if (!p) throw mkErr("pkce", "Vuelve a pulsar «Abrir Dropbox» y repite el proceso.");
    const j = await tokenRequest({ code: String(code || "").trim(), grant_type: "authorization_code", code_verifier: p.verifier, client_id: APP_KEY });
    if (!j.refresh_token) throw mkErr("auth", "Dropbox no ha devuelto una conexión duradera. Vuelve a intentarlo.");
    await storeTokens(j); await kvDel("pkce"); pk = null; state = {}; await saveState(); setStatus({ connected: true, error: null });
  }
  async function disconnect() { auth = null; await kvDel("auth"); state = {}; await kvDel("state"); setStatus({ connected: false, error: null, pending: false, lastSyncAt: null, lastResult: null }); }
  async function accessToken() {
    if (!auth) throw mkErr("no-auth", "Dropbox no está conectado en este dispositivo.");
    if (auth.expires_at > Date.now()) return auth.access_token;
    try { await storeTokens(await tokenRequest({ grant_type: "refresh_token", refresh_token: auth.refresh_token, client_id: APP_KEY }), auth); }
    catch (e) { if (e.code === "invalid_grant") { await disconnect(); throw mkErr("reconnect", "La conexión con Dropbox ha caducado. Vuelve a conectar."); } throw e; }
    return auth.access_token;
  }
  async function dbx(url, init, retry) {
    init.headers = Object.assign({}, init.headers || {}, { Authorization: "Bearer " + await accessToken() });
    let res; try { res = await fetch(url, init); } catch (e) { throw mkErr("network", "No se pudo contactar con Dropbox (¿sin conexión?)."); }
    if (res.status === 401 && !retry) { auth.expires_at = 0; return dbx(url, init, true); }
    if (res.ok) return res;
    let body = {}; try { body = await res.json(); } catch (e) { /* noop */ }
    const sm = String(body.error_summary || "");
    if (res.status === 409 && /not_found/.test(sm)) throw mkErr("not_found", sm);
    if (res.status === 409 && /conflict/.test(sm)) throw mkErr("conflict", sm);
    if (/missing_scope/.test(sm)) throw mkErr("scope", "Faltan permisos en la app de Dropbox (files.content.read/write y files.metadata.read).");
    if (res.status === 429) throw mkErr("rate", "Dropbox pide esperar un momento. Se reintentará.");
    throw mkErr("api", "Dropbox respondió con un error (" + res.status + "): " + (sm || "sin detalles"));
  }
  async function remoteGet() {
    let meta;
    try { meta = await (await dbx("https://api.dropboxapi.com/2/files/get_metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: FILE_PATH }) })).json(); }
    catch (e) { if (e.code === "not_found") return null; throw e; }
    const r2 = await dbx("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: { "Dropbox-API-Arg": JSON.stringify({ path: "rev:" + meta.rev }) } });
    return { text: await r2.text(), rev: meta.rev };
  }
  async function remotePut(text, rev, path, auto) {
    const arg = { path: path || FILE_PATH, mode: rev ? { ".tag": "update", update: rev } : { ".tag": "add" }, autorename: !!auto, mute: true };
    return (await dbx("https://content.dropboxapi.com/2/files/upload", { method: "POST", headers: { "Dropbox-API-Arg": JSON.stringify(arg), "Content-Type": "application/octet-stream" }, body: new Blob([text]) })).json();
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const stampName = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };
  async function waitQuiet(auto) {   // las sincronizaciones automáticas esperan a que no estés escribiendo ni tengas una ventana abierta
    if (!auto || typeof document === "undefined") return true;
    for (let i = 0; i < 60; i++) { const a = document.activeElement, typing = a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== "file" && a.value; if (!document.querySelector(".vel") && !typing) return true; await new Promise(r => setTimeout(r, 1000)); }
    return false;
  }
  async function doSync(opts) {
    if (!auth) throw mkErr("no-auth", "Dropbox no está conectado en este dispositivo.");
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setStatus({ pending: true, error: null }); return { offline: true }; }
    setStatus({ busy: true, error: null }); let result = null;
    try {
      for (let at = 0; at < 4; at++) {
        host.stamp(); const local = clone(host.get()), remote = await remoteGet(); let rd = null, m;
        if (remote) {
          try { rd = JSON.parse(remote.text); } catch (e) { throw mkErr("bad-remote", "El archivo de Dropbox no es un JSON válido. No se ha modificado."); }
          if (!rd || !Array.isArray(rd.pets)) throw mkErr("bad-remote", "El archivo de Dropbox no tiene la estructura de La Huella. No se ha modificado.");
          ensureStamps(rd); m = mergeData(local, rd);
        } else m = { data: Object.assign({ format: "huella-bibi-tris", version: 1, schema: 2, exportedAt: nowIso() }, clone({ pets: local.pets, pienso: local.pienso || [], gastos: local.gastos || [], deleted: local.deleted || [] })), stats: {} };
        const changed = !rd || canon(m.data) !== canon(rd);
        if (changed) {
          const doneDay = rd && rd.lastRemoteBackup;   // copia en Dropbox (máx. 1 al día) de lo que había antes de cambiarlo
          if (remote && doneDay !== today()) { try { await remotePut(remote.text, null, "/BACKUP/BK_Huella-de-Bibi-y-Tris_" + stampName() + ".json", true); m.data.lastRemoteBackup = today(); } catch (e) { if (e.code === "network") throw e; } }
          else if (doneDay) m.data.lastRemoteBackup = doneDay;
          try { state.rev = (await remotePut(JSON.stringify(m.data), remote ? remote.rev : null)).rev; } catch (e) { if (e.code === "conflict" && at < 3) continue; throw e; }
        } else if (remote) state.rev = remote.rev;
        if (!(await waitQuiet(opts && opts.auto))) { setStatus({ busy: false, pending: true }); return { deferred: true }; }
        host.stamp(); const cur = clone(host.get()), fin = mergeData(cur, m.data), differs = canon(fin.data) !== canon(cur);
        if (differs) {
          if (state.localBackupDay !== today() || !state.firstDone) { try { await host.backup("ANTES_DE_SINCRONIZAR"); state.localBackupDay = today(); } catch (e) { /* protección opcional */ } }
          await host.replace(fin.data);
        }
        if (canon(cur) !== canon(local) || canon(fin.data) !== canon(m.data)) rerun = true;
        state.firstDone = true; state.lastSyncAt = Date.now();
        result = { stats: remote ? fin.stats : { firstUpload: true }, applied: differs, uploaded: changed }; break;
      }
      state.lastResult = summarize(result); await saveState();
      setStatus({ busy: false, pending: false, error: null, lastSyncAt: state.lastSyncAt, lastResult: state.lastResult });
      return result;
    } catch (e) { setStatus({ busy: false, error: e.message, pending: e.code === "network" }); throw e; }
  }
  function summarize(r) {
    if (!r) return "";
    if (r.stats && r.stats.firstUpload) return "Primera sincronización: tus datos se han subido a Dropbox.";
    const s = r.stats || {}, parts = [], add = (n, a, b) => { if (n) parts.push(n + " " + (n === 1 ? a : b)); };
    add(s.petsAdded, "peludo nuevo", "peludos nuevos"); add(s.petsUpdated, "ficha actualizada", "fichas actualizadas"); add(s.petsRemoved, "peludo eliminado", "peludos eliminados");
    add(s.itemsAdded, "registro nuevo", "registros nuevos"); add(s.itemsUpdated, "registro actualizado", "registros actualizados"); add(s.itemsRemoved, "registro eliminado", "registros eliminados");
    return ((parts.length ? "Recibido: " + parts.join(", ") + ". " : "") + (r.uploaded ? "Tus cambios se han enviado a Dropbox." : "")).trim() || "Todo estaba al día.";
  }
  function syncNow(opts) { if (running) { rerun = true; return running; } running = doSync(opts || {}).finally(() => { running = null; if (rerun) { rerun = false; schedule(1500); } }); return running; }
  function schedule(ms) { if (!auth) return; clearTimeout(timer); timer = setTimeout(() => { syncNow({ auto: true }).catch(() => {}); }, ms == null ? 4000 : ms); }
  async function init(h) {
    host = h;
    try { auth = await kvGet("auth") || null; state = (await kvGet("state")) || {}; status.connected = !!auth; status.lastSyncAt = state.lastSyncAt || null; status.lastResult = state.lastResult || null; } catch (e) { console.warn("Sync:", e); }
    notify();
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => schedule(1000));
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (!state.lastSyncAt || Date.now() - state.lastSyncAt > 60000)) schedule(1500); });
      setInterval(() => { if (document.visibilityState === "visible") schedule(500); }, 5 * 60 * 1000);
    }
    if (auth) schedule(1500);
  }
  const api = { _setNow: f => { nowFn = f; }, EPOCH, ensureStamps, makeBase, stampChanges, mergeData, canon, init, syncNow, schedule, connectWithCode, disconnect,
    authUrl: async () => (await getPkce()).url, status: () => status, onStatus: f => listeners.push(f),
    reset: d => { base = makeBase(d); }, stamp: d => { base = stampChanges(d, base); } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Sync = api;
})(typeof window !== "undefined" ? window : globalThis);
