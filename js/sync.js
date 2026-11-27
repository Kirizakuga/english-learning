/* Cross-device sync. When the page runs as a claude.ai artifact with the `db`
 * capability, progress is kept in the viewer's private document
 * data/users/<id>/progress and merged with this device's copy (Engine.mergeStates).
 * Anywhere else (a plain static host), sync stays off and Store keeps progress
 * on this device only. */
(function (root) {
  'use strict';
  var E = root.Engine;
  var ref = null, bank = null, getState = null, applyState = null;
  var timer = null, writing = false, again = false, lastJson = '', loadTimer = null;
  var listeners = [];

  var Sync = {
    status: 'off',          // off | connecting | synced | saving | unreachable | error
    lastSync: 0,
    onStatus: function (fn) { listeners.push(fn); },
    start: start,
    changed: function () { schedule(2500); },
    flush: function () { clearTimeout(timer); push(); }
  };

  function setStatus(s) {
    Sync.status = s;
    listeners.forEach(function (fn) { try { fn(s); } catch (e) { /* ignore */ } });
  }

  function start(opts) {
    bank = opts.bank; getState = opts.getState; applyState = opts.apply;
    if (!root.claude || typeof root.claude.use !== 'function') return setStatus('off');
    setStatus('connecting');
    Promise.all([root.claude.use('db'), root.claude.use('user')]).then(function (r) {
      var db = r[0], user = r[1];
      if (!db || !user) return setStatus('off');
      return user.id().then(function (uid) {
        if (!uid) return setStatus('off');
        ref = db.doc('data/users/' + uid + '/progress');
        loadTimer = setTimeout(function () { if (Sync.status === 'connecting') setStatus('unreachable'); }, 10000);
        ref.onSnapshot(onRemote, function (err) {
          clearTimeout(loadTimer);
          ref = null;
          setStatus(err && err.code === 'revoked' ? 'off' : 'error');
        });
      });
    }).catch(function () { setStatus('off'); });
  }

  function onRemote(snap) {
    if (snap.metadata.hasPendingWrites) return;      // our own write, not confirmed yet
    var remoteJson = snap.exists ? JSON.stringify(snap.data()) : '';
    if (!snap.metadata.fromCache) {
      clearTimeout(loadTimer);
      Sync.lastSync = Date.now();
      if (Sync.status !== 'saving') setStatus('synced');
    }
    if (remoteJson && remoteJson === lastJson) return; // echo of what we wrote
    var local = getState();
    var merged = snap.exists ? E.mergeStates(local, E.fromRemote(snap.data(), bank), Date.now()) : local;
    var mergedJson = JSON.stringify(E.toRemote(merged, bank));
    if (snap.exists && mergedJson !== JSON.stringify(E.toRemote(local, bank))) applyState(merged);
    if (mergedJson !== remoteJson) schedule(snap.exists ? 800 : 0);   // remote is missing something we have
    else lastJson = remoteJson;
  }

  function schedule(ms) {
    if (!ref) return;
    clearTimeout(timer);
    timer = setTimeout(push, ms);
  }

  function push(retried) {
    if (!ref) return;
    if (writing) { again = true; return; }
    var body = E.toRemote(getState(), bank);
    var json = JSON.stringify(body);
    if (json === lastJson) return;
    writing = true;
    setStatus('saving');
    ref.set(body).then(function () {
      lastJson = json;
      Sync.lastSync = Date.now();
      setStatus('synced');
    }, function (err) {
      var code = err && err.code;
      if (code === 'unavailable' && !retried) { setTimeout(function () { push(true); }, 1500 + Math.random() * 2000); return; }
      setStatus(code === 'unavailable' || code === 'resource_exhausted' ? 'unreachable' : 'error');
    }).then(function () {
      writing = false;
      if (again) { again = false; schedule(500); }
    });
  }

  function hidden() { if (document.visibilityState === 'hidden') Sync.flush(); }
  document.addEventListener('visibilitychange', hidden);
  root.addEventListener('pagehide', function () { Sync.flush(); });

  root.Sync = Sync;
})(window);
