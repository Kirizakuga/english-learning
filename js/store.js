/* Progress storage. One JSON object behind a tiny interface so the backend
 * can be swapped (e.g. for a synced store) without touching the app.
 * localStorage is wrapped in try/catch: if it fails, progress lives in memory. */
(function (root) {
  'use strict';
  var KEY = 'grammar-band9:progress:v1';
  var memory = null;
  var available = true;
  var timer = null;

  function load() {
    try {
      var raw = root.localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { available = false; }
    return memory;
  }

  function write(state) {
    memory = state;
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); available = true; }
    catch (e) { available = false; }
  }

  // Debounced save; call flush() before leaving a screen.
  function save(state) {
    memory = state;
    clearTimeout(timer);
    timer = setTimeout(function () { write(state); }, 250);
  }

  function flush() {
    clearTimeout(timer);
    if (memory) write(memory);
  }

  function reset() {
    memory = null;
    try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function getPref(name) {
    try { return root.localStorage.getItem('grammar-band9:' + name); } catch (e) { return null; }
  }
  function setPref(name, value) {
    try { root.localStorage.setItem('grammar-band9:' + name, value); } catch (e) { /* ignore */ }
  }

  root.Store = {
    load: load, save: save, flush: flush, reset: reset, getPref: getPref, setPref: setPref,
    get available() { return available; }
  };
  root.addEventListener && root.addEventListener('pagehide', flush);
})(window);
