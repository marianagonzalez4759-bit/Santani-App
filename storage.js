/* Santani Calzado: almacenamiento local para usar la app fuera de Claude.
   La app pide tres cosas a window.claude.use(): "db" (datos), "assets" (fotos)
   y "user" (permisos). Este archivo las ofrece guardando todo en el navegador
   (IndexedDB), así que los datos se quedan en el equipo donde se usa la app.
   También agrega la copia de seguridad (guardar y restaurar un archivo). */
(function () {
  'use strict';
  if (window.claude && window.claude.use) return; // dentro de Claude ya existe

  window.SANTANI_STANDALONE = true;

  var idb = null;
  var persistOk = true;
  var mem = {};          // mem[coleccion][id] = datos
  var blobs = {};        // blobs[id] = {buf, type}
  var urlCache = {};     // id -> object URL
  var listeners = {};    // coleccion -> [{next, error}]
  var bc = null;
  try { bc = new BroadcastChannel('santani-db'); } catch (e) { bc = null; }

  /* ---------- utilidades ---------- */
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function hex(n) {
    var a = new Uint8Array(n / 2);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function merge(base, patch) {
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (isObj(v) && v.__delete__ === true) { delete base[k]; return; }
      if (isObj(v) && isObj(base[k])) base[k] = merge(base[k], v);
      else base[k] = clone(v);
    });
    return base;
  }
  function toB64(buf) {
    var bytes = new Uint8Array(buf), s = '', step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(s);
  }
  function fromB64(b64) {
    var s = atob(b64), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a.buffer;
  }
  function readBuf(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
      r.readAsArrayBuffer(blob);
    });
  }

  /* ---------- IndexedDB ---------- */
  function openIDB() {
    return new Promise(function (ok, no) {
      if (!window.indexedDB) return no(new Error('sin indexedDB'));
      var r = indexedDB.open('santani-calzado', 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        d.createObjectStore('docs', { keyPath: 'key' });
        d.createObjectStore('assets', { keyPath: 'id' });
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
      r.onblocked = function () { no(new Error('bloqueado')); };
    });
  }
  function tx(store, mode, fn) {
    return new Promise(function (ok, no) {
      var t = idb.transaction(store, mode), res = fn(t.objectStore(store));
      t.oncomplete = function () { ok(res && res.result); };
      t.onerror = t.onabort = function () { no(t.error || new Error('transacción')); };
    });
  }
  function loadDocs() {
    return tx('docs', 'readonly', function (s) { return s.getAll(); }).then(function (rows) {
      var out = {};
      (rows || []).forEach(function (r) { (out[r.col] = out[r.col] || {})[r.id] = r.data; });
      return out;
    });
  }

  /* ---------- notificaciones ---------- */
  function docSnap(id, data) {
    var ex = data !== undefined;
    return Object.freeze({
      id: id, exists: ex,
      data: function () { return ex ? clone(data) : undefined; },
      metadata: { fromCache: false, hasPendingWrites: false }
    });
  }
  function colSnap(col) {
    var m = mem[col] || {};
    var docs = Object.keys(m).sort().map(function (id) { return docSnap(id, m[id]); });
    return {
      docs: docs, size: docs.length, empty: !docs.length,
      docChanges: function () { return []; },
      metadata: { fromCache: false, hasPendingWrites: false }
    };
  }
  function notify(col) {
    (listeners[col] || []).slice().forEach(function (l) {
      try { l.next(colSnap(col)); } catch (e) { console.error(e); }
    });
  }
  if (bc) {
    bc.onmessage = function (e) {
      var col = e.data && e.data.col;
      if (!col || !idb) return;
      loadDocs().then(function (all) { mem[col] = all[col] || {}; notify(col); }).catch(function () {});
    };
  }

  /* ---------- escritura ---------- */
  function persistErr(e) { return { code: 'unavailable', message: String(e && e.message || e) }; }
  function put(col, id, data) {
    (mem[col] = mem[col] || {})[id] = clone(data);
    notify(col);
    if (!idb) return Promise.resolve();
    return tx('docs', 'readwrite', function (s) { return s.put({ key: col + '/' + id, col: col, id: id, data: clone(data) }); })
      .then(function () { if (bc) bc.postMessage({ col: col }); })
      .catch(function (e) { throw persistErr(e); });
  }
  function del(col, id) {
    if (mem[col]) delete mem[col][id];
    notify(col);
    if (!idb) return Promise.resolve();
    return tx('docs', 'readwrite', function (s) { return s.delete(col + '/' + id); })
      .then(function () { if (bc) bc.postMessage({ col: col }); })
      .catch(function (e) { throw persistErr(e); });
  }
  function subscribe(col, next, error, only) {
    var l = { next: only ? function (snap) { next(docSnap(only, (mem[col] || {})[only])); } : next, error: error };
    (listeners[col] = listeners[col] || []).push(l);
    setTimeout(function () {
      if (listeners[col] && listeners[col].indexOf(l) >= 0) l.next(colSnap(col));
    }, 0);
    return function () {
      var a = listeners[col] || [], i = a.indexOf(l);
      if (i >= 0) a.splice(i, 1);
    };
  }
  function docRef(col, id) {
    return {
      id: id, path: col + '/' + id,
      get: function () { return Promise.resolve(docSnap(id, (mem[col] || {})[id])); },
      set: function (d) { return put(col, id, d); },
      update: function (d) {
        var cur = (mem[col] || {})[id];
        if (cur === undefined) return Promise.reject({ code: 'invalid_argument', message: 'El documento no existe' });
        return put(col, id, merge(clone(cur), d));
      },
      delete: function () { return del(col, id); },
      onSnapshot: function (next, error) { return subscribe(col, next, error, id); },
      collection: function () { throw new TypeError('Subcolecciones no disponibles'); }
    };
  }
  function colRef(col) {
    return {
      path: col,
      doc: function (id) { return docRef(col, id || hex(20)); },
      add: function (d) { var r = docRef(col, hex(20)); return r.set(d).then(function () { return r; }); },
      get: function () { return Promise.resolve(colSnap(col)); },
      onSnapshot: function (next, error) { return subscribe(col, next, error); }
    };
  }
  var DB = {
    doc: function (path) {
      var p = String(path).split('/');
      if (p.length !== 2) throw new TypeError('Ruta de documento no válida: ' + path);
      return docRef(p[0], p[1]);
    },
    collection: function (path) {
      if (String(path).split('/').length !== 1) throw new TypeError('Ruta de colección no válida: ' + path);
      return colRef(path);
    }
  };

  /* ---------- fotos ---------- */
  function blobURL(id) {
    if (urlCache[id]) return Promise.resolve(urlCache[id]);
    var get = blobs[id] ? Promise.resolve(blobs[id]) :
      (idb ? tx('assets', 'readonly', function (s) { return s.get(id); }) : Promise.resolve(null));
    return get.then(function (rec) {
      if (!rec) return null;
      blobs[id] = rec;
      return (urlCache[id] = URL.createObjectURL(new Blob([rec.buf], { type: rec.type })));
    }).catch(function () { return null; });
  }
  var ASSETS = {
    upload: function (blob) {
      if (!(blob instanceof Blob) || !blob.size) return Promise.reject({ code: 'invalid_request', message: 'Archivo vacío' });
      var type = blob.type || 'image/jpeg';
      return readBuf(blob).then(function (buf) {
        var id = hex(32);
        blobs[id] = { id: id, buf: buf, type: type };
        var done = idb ? tx('assets', 'readwrite', function (s) { return s.put(blobs[id]); }) : Promise.resolve();
        return done.then(function () { return { id: id, url: '/_blob/' + id, sizeBytes: blob.size, contentType: type }; });
      }).catch(function (e) {
        throw e && e.code ? e : { code: 'quota_or_state', message: String(e && e.message || e) };
      });
    },
    delete: function (id) {
      delete blobs[id];
      if (urlCache[id]) { URL.revokeObjectURL(urlCache[id]); delete urlCache[id]; }
      if (!idb) return Promise.resolve({ deleted: true });
      return tx('assets', 'readwrite', function (s) { return s.delete(id); }).then(function () { return { deleted: true }; });
    },
    list: function () { return Promise.resolve({ assets: [], usage: {} }); }
  };

  /* Las imágenes de la app apuntan a /_blob/<id>: aquí se cambian por la foto guardada. */
  function fixImg(img) {
    var s = img.getAttribute('src');
    if (!s || s.indexOf('/_blob/') !== 0) return;
    var id = s.slice(7);
    blobURL(id).then(function (u) {
      if (u && img.getAttribute('src') === s) img.setAttribute('src', u);
    });
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'IMG') fixImg(node);
    else if (node.querySelectorAll) [].forEach.call(node.querySelectorAll('img[src^="/_blob/"]'), fixImg);
  }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      if (m.type === 'attributes') fixImg(m.target);
      else [].forEach.call(m.addedNodes, scan);
    });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });

  /* ---------- usuario ---------- */
  var USER = {
    isOwner: function () { return true; },
    canEdit: function () { return true; },
    can: function () { return Promise.resolve(true); },
    id: function () { return Promise.resolve('local'); },
    me: function () { return Promise.resolve({ id: 'local', name: '' }); }
  };

  /* ---------- copia de seguridad ---------- */
  function exportAll() {
    var docs = [];
    Object.keys(mem).forEach(function (col) {
      Object.keys(mem[col]).forEach(function (id) { docs.push({ col: col, id: id, data: mem[col][id] }); });
    });
    var rows = idb ? tx('assets', 'readonly', function (s) { return s.getAll(); }) :
      Promise.resolve(Object.keys(blobs).map(function (k) { return blobs[k]; }));
    return rows.then(function (list) {
      return {
        app: 'santani-calzado', version: 1, fecha: new Date().toISOString(), docs: docs,
        assets: (list || []).map(function (r) { return { id: r.id, type: r.type, b64: toB64(r.buf) }; })
      };
    });
  }
  function importAll(data) {
    if (!data || data.app !== 'santani-calzado' || !Array.isArray(data.docs)) {
      return Promise.reject(new Error('Este archivo no es una copia de Santani Calzado.'));
    }
    var cols = Object.keys(mem);
    data.docs.forEach(function (d) { if (cols.indexOf(d.col) < 0) cols.push(d.col); });
    var next = {};
    data.docs.forEach(function (d) { (next[d.col] = next[d.col] || {})[d.id] = d.data; });
    var fresh = {};
    (data.assets || []).forEach(function (a) { fresh[a.id] = { id: a.id, type: a.type, buf: fromB64(a.b64) }; });
    var save = idb ? Promise.all([
      tx('docs', 'readwrite', function (s) {
        s.clear();
        data.docs.forEach(function (d) { s.put({ key: d.col + '/' + d.id, col: d.col, id: d.id, data: d.data }); });
      }),
      tx('assets', 'readwrite', function (s) {
        s.clear();
        Object.keys(fresh).forEach(function (k) { s.put(fresh[k]); });
      })
    ]) : Promise.resolve();
    return save.then(function () {
      Object.keys(urlCache).forEach(function (k) { URL.revokeObjectURL(urlCache[k]); });
      urlCache = {}; blobs = fresh; mem = next;
      cols.forEach(function (c) { if (bc) bc.postMessage({ col: c }); notify(c); });
    });
  }
  window.SANTANI_BACKUP = { exportAll: exportAll, importAll: importAll };
  window.SANTANI_BLOBURL = blobURL; // la app lo usa para leer las fotos al armar el catálogo

  function fmtDay(iso) {
    try { return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; }
  }
  function lastBackup() { try { return localStorage.getItem('santani:respaldo') || ''; } catch (e) { return ''; } }
  function hayDatos() { return Object.keys(mem).some(function (c) { return Object.keys(mem[c]).length; }); }

  function mountBackup() {
    var wrap = document.querySelector('.wrap'), main = document.getElementById('main');
    if (!wrap || !main) return;
    var sec = document.createElement('section');
    sec.id = 'respaldo'; sec.hidden = true;
    sec.innerHTML =
      '<div class="sec"><h3>Copia de seguridad</h3></div>' +
      '<div class="card"><p>Sus datos se guardan en este equipo, no en internet. Guarde una copia de vez en cuando por si cambia de teléfono o se borran los datos del navegador.</p>' +
      '<p id="rs-estado" class="sub"></p><div id="rs-msg" role="status"></div>' +
      '<button class="btn primary block" id="rs-exp">Guardar copia en mi equipo</button>' +
      '<button class="btn block" id="rs-imp" style="margin-top:10px">Restaurar una copia</button>' +
      '<input type="file" id="rs-file" accept=".json,application/json" hidden></div>';
    wrap.appendChild(sec);
    var msg = sec.querySelector('#rs-msg'), est = sec.querySelector('#rs-estado'), file = sec.querySelector('#rs-file');
    var pending = null;

    function estado() {
      var l = lastBackup(), warn = !l && hayDatos();
      var txt = l ? 'Última copia: ' + fmtDay(l) + '.' : (hayDatos() ? 'Todavía no ha guardado ninguna copia.' : '');
      if (!persistOk) txt = 'Este navegador no permite guardar datos. Los cambios se perderán al cerrar la página. Abra la app en otro navegador.';
      est.textContent = txt;
      est.className = (warn || !persistOk) ? 'warn' : 'sub';
    }
    function say(html, cls) { msg.innerHTML = html ? '<p class="' + (cls || 'ok') + '">' + html + '</p>' : ''; }

    sec.querySelector('#rs-exp').addEventListener('click', function () {
      exportAll().then(function (obj) {
        var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
        var a = document.createElement('a'), d = new Date();
        a.href = URL.createObjectURL(blob);
        a.download = 'santani-copia-' + d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
        try { localStorage.setItem('santani:respaldo', obj.fecha); } catch (e) {}
        estado(); say('Copia guardada. Busque el archivo en sus descargas.');
      }).catch(function () { say('No se pudo guardar la copia. Intente otra vez.', 'bad'); });
    });
    sec.querySelector('#rs-imp').addEventListener('click', function () { say(''); file.value = ''; file.click(); });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try { pending = JSON.parse(r.result); } catch (e) { pending = null; }
        if (!pending || pending.app !== 'santani-calzado') { pending = null; say('Ese archivo no es una copia de Santani Calzado.', 'bad'); return; }
        msg.innerHTML = '<p class="warn">Se reemplazarán todos los datos de este equipo con los de la copia del ' + esc(fmtDay(pending.fecha)) + '. ¿Continuar?</p>' +
          '<div class="pair"><button class="btn danger fill" id="rs-si">Sí, restaurar</button><button class="btn" id="rs-no">No</button></div>';
        msg.querySelector('#rs-no').addEventListener('click', function () { pending = null; say(''); });
        msg.querySelector('#rs-si').addEventListener('click', function () {
          importAll(pending).then(function () { pending = null; estado(); say('Copia restaurada.'); })
            .catch(function (e) { say(esc(e && e.message || 'No se pudo restaurar la copia.'), 'bad'); });
        });
      };
      r.readAsText(f);
    });
    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    function sync() { sec.hidden = !main.querySelector('.hero'); if (!sec.hidden) estado(); }
    new MutationObserver(sync).observe(main, { childList: true });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBackup);
  else mountBackup();

  /* ---------- arranque ---------- */
  var ready = openIDB().then(function (d) {
    idb = d;
    return loadDocs().then(function (all) { mem = all; });
  }).catch(function () {
    persistOk = false; idb = null;
  }).then(function () {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    if (!persistOk) {
      document.addEventListener('DOMContentLoaded', function () {
        var b = document.getElementById('banner');
        if (b) { b.hidden = false; b.textContent = 'Este navegador no permite guardar datos. Abra la app en otro navegador para no perder lo que anote.'; }
      });
    }
  });

  window.claude = {
    use: function (name) {
      return ready.then(function () {
        if (name === 'db') return DB;
        if (name === 'assets') return ASSETS;
        if (name === 'user') return USER;
        return null;
      });
    }
  };

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
