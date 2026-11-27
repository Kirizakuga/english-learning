/* Grammar to Band 9 — UI. Screens: topic map, visual lesson, practice session, summary. */
(function () {
  'use strict';
  var E = window.Engine;
  var app = document.getElementById('app');
  var announcer = document.getElementById('announcer');

  var ROLES = { s: 'subject', aux: 'helper', v: 'verb', o: 'object / word', x: 'time / extra', c: 'connector' };
  var KIND_LABEL = {
    choose: 'Fill the gap', correct: 'Pick the correct sentence', judge: 'Correct or incorrect?',
    fix: 'Fix the highlighted part', type: 'Type the missing word'
  };
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var bank = null, state = null;
  var session = null;      // active E.Session
  var ui = {};             // practice screen state
  var lastSummary = null;
  var timerId = null;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function clockText(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function topic(id) { return bank.topic[id]; }
  function levelName(l) { return E.LEVEL_NAMES[l]; }
  function bandParts(t) {
    var p = t.bandLabel.split(' · ');
    return { band: p[0], name: p[1] || '' };
  }
  function announce(msg) { announcer.textContent = ''; setTimeout(function () { announcer.textContent = msg; }, 30); }
  function save() { Store.save(state); }

  /* ---------- theme ---------- */
  function applyTheme(t) {
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function toggleTheme() {
    var next = isDark() ? 'light' : 'dark';
    applyTheme(next);
    Store.setPref('theme', next);
    render();
  }
  applyTheme(Store.getPref('theme'));

  /* ---------- boot ---------- */
  function renderLoading() {
    app.innerHTML =
      '<div class="loading"><div class="loading-inner">' + brand() +
      '<div class="bar" role="progressbar" aria-label="Loading questions"><span></span></div>' +
      '<p>Loading 5,407 questions…</p></div></div>';
  }

  function renderError(err) {
    app.innerHTML =
      '<div class="loading"><div class="slab error-box"><h2>The question bank did not load</h2>' +
      '<p>The app reads <code>data/topics.json</code> and <code>data/questions.json</code> from the same folder. ' +
      'Browsers block this when the page is opened as a file. Start a small web server in the project folder, ' +
      'for example <code>python3 -m http.server</code>, then open <code>http://localhost:8000</code>.</p>' +
      '<p class="refresh">' + esc(err && err.message || err) + '</p>' +
      '<button class="btn btn-mark" data-act="retry">Try again</button></div></div>';
  }

  function boot() {
    renderLoading();
    Promise.all([
      fetch('data/topics.json').then(function (r) { if (!r.ok) throw new Error('topics.json: ' + r.status); return r.json(); }),
      fetch('data/questions.json').then(function (r) { if (!r.ok) throw new Error('questions.json: ' + r.status); return r.json(); })
    ]).then(function (res) {
      bank = E.createBank(res[0], res[1]);
      state = E.normaliseState(Store.load());
      route();
    }).catch(renderError);
  }

  /* ---------- routing (plain #name hashes only) ---------- */
  function go(hash) {
    if (location.hash === '#' + hash) route();
    else location.hash = hash;
  }

  function route() {
    if (!bank) return;
    var h = location.hash.replace(/^#/, '');
    stopTimer();
    if (h === 'practice' && session) return renderSession();
    if (h !== 'practice' && session) endSession(false);
    if (h === 'results' && lastSummary) return renderSummary();
    var m = /^lesson-(.+)$/.exec(h);
    if (m && bank.topic[m[1]]) return renderLesson(m[1]);
    renderMap();
  }
  window.addEventListener('hashchange', route);

  function render() { route(); }

  /* ---------- shared pieces ---------- */
  function brand() {
    return '<a class="brand" href="#map" aria-label="Grammar to Band 9, topic map">' +
      '<span class="brand-dots" aria-hidden="true"><i></i><i></i><i></i></span>Grammar to Band 9</a>';
  }

  function masthead() {
    return '<header class="masthead">' + brand() +
      '<button class="btn icon-btn" data-act="theme" aria-label="' + (isDark() ? 'Use light theme' : 'Use dark theme') + '">' +
      (isDark() ? '☀' : '☾') + '</button></header>';
  }

  function ring(p) {
    var r = 13, c = 2 * Math.PI * r;
    return '<svg class="ring" viewBox="0 0 34 34" aria-hidden="true">' +
      '<circle class="track" cx="17" cy="17" r="' + r + '" fill="none" stroke-width="5"/>' +
      '<circle class="fill" cx="17" cy="17" r="' + r + '" fill="none" stroke-width="5" stroke-linecap="butt" ' +
      'stroke-dasharray="' + (c * p).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 17 17)"/></svg>';
  }

  function badge(l) {
    return '<span class="badge lvl-' + l + '">' + (l === 3 ? '★ ' : '') + levelName(l) + '</span>';
  }

  function chips(row) {
    return '<div class="formula">' + row.map(function (c) {
      return '<span class="part" data-role="' + esc(c.role) + '"><span class="chip r-' + esc(c.role) + '">' + esc(c.text) +
        '</span><small>' + esc(ROLES[c.role] || c.role) + '</small></span>';
    }).join('') + '</div>';
  }

  /* ---------- topic map ---------- */
  function renderMap() {
    var now = Date.now();
    var mastered = bank.topics.filter(function (t) { return E.levelOf(state, t.id) === 3; }).length;
    var reviewCount = E.reviewList(state, now, false).length;
    var dueCount = E.reviewList(state, now, true).length;
    var weak = E.weakest(state, bank, 3);
    var focusNames = weak.slice(0, 2).map(function (w) { return esc(topic(w.id).title); });
    var started = state.answered > 0;

    var html = masthead();
    html += '<section class="slab today" aria-labelledby="today-h"><div class="today-top">' +
      '<div class="hello"><h1 id="today-h">' + (started ? 'Welcome back, Hiếu.' : 'Hi Hiếu. Let’s start.') + '</h1>' +
      '<p>One session is about 30 minutes. It mixes old mistakes, your weakest topics and a short boss round.</p></div>' +
      '<dl class="stats">' +
      '<div class="stat"><dt>topics mastered</dt><dd>' + mastered + '<small>/44</small></dd></div>' +
      '<div class="stat"><dt>questions answered</dt><dd>' + state.answered.toLocaleString('en') + '</dd></div>' +
      '<div class="stat"><dt>day streak</dt><dd>' + E.streak(state, now) + '</dd></div>' +
      '</dl></div>' +
      '<div class="plan"><div class="plan-strip" aria-label="Session plan">' +
      planStep('Warm-up', '5 min', 5, dueCount ? dueCount + ' to review' : 'none due') +
      planStep('Focus', '15 min', 15) + planStep('Mixed', '8 min', 8) + planStep('Boss', '5 items', 3) +
      '</div><p class="plan-note">Focus today: <strong>' + focusNames.join('</strong> and <strong>') + '</strong>.</p></div>' +
      '<div class="cta-row"><button class="btn btn-mark btn-xl" data-act="start-main">Start session</button>' +
      '<button class="btn" data-act="review"' + (reviewCount ? '' : ' disabled') + '>Review mistakes <span class="count">' + reviewCount + '</span></button></div>' +
      '</section>';

    html += '<section class="suggest" aria-labelledby="sug-h"><div class="section-head"><h2 id="sug-h">Suggested next</h2>' +
      '<p>Your weakest topics. Tap one to see the lesson.</p></div><div class="suggest-row">' +
      weak.map(function (w) {
        var t = topic(w.id), st = state.topics[w.id];
        var why = w.why === 'mistake' ? '<strong>A mistake you often make.</strong> ' : w.why === 'new' ? '<strong>Next new topic.</strong> ' : '<strong>Lowest recent score.</strong> ';
        if (st && st.last.length) why += 'Last ' + st.last.length + ': ' + pct(E.acc20(st)) + ' right.';
        return '<a class="slab suggest-card" href="#lesson-' + esc(t.id) + '"><h3>' + esc(t.title) + '</h3>' +
          '<span class="tile-vi" lang="vi">' + esc(t.vi) + '</span><span class="why">' + why + '</span></a>';
      }).join('') + '</div></section>';

    [1, 2, 3, 4].forEach(function (b) {
      var ts = bank.topics.filter(function (t) { return t.band === b; });
      if (!ts.length) return;
      var bp = bandParts(ts[0]);
      var m = ts.filter(function (t) { return E.levelOf(state, t.id) === 3; }).length;
      html += '<section class="band" aria-labelledby="band-' + b + '"><div class="band-head">' +
        '<span class="band-num">' + esc(bp.band) + '</span><h2 id="band-' + b + '">' + esc(bp.name) + '</h2>' +
        '<p>' + m + ' of ' + ts.length + ' mastered</p></div><div class="tiles">' +
        ts.map(tile).join('') + '</div></section>';
    });

    html += '<footer class="foot"><span>' + bank.questions.length.toLocaleString('en') + ' questions · 44 topics</span>' +
      (Store.available ? '<span>Progress is saved on this device.</span>' : '<span>Progress can’t be saved in this browser. It will reset when you close the page.</span>') +
      '<span class="confirm" id="reset-zone"><button data-act="reset-ask">Reset progress</button></span></footer>';
    app.innerHTML = html;
  }

  function planStep(name, time, grow, note) {
    return '<div class="plan-step" style="flex:' + grow + '"><b>' + name + '</b><span>' + time + (note ? ', ' + note : '') + '</span></div>';
  }

  function tile(t) {
    var st = state.topics[t.id], l = st ? st.level : 0;
    var prio = E.PRIORITY.indexOf(t.id) >= 0 && l < 2;
    var label = t.title + ', ' + levelName(l) + (st && st.refresh ? ', needs a refresh' : '');
    return '<a class="tile lvl-' + l + '" href="#lesson-' + esc(t.id) + '" aria-label="' + esc(label) + '">' +
      (prio ? '<span class="prio" title="One of your common mistakes">Your mistake</span>' : '') +
      '<span class="tile-title">' + esc(t.title) + '</span>' +
      '<span class="tile-vi" lang="vi">' + esc(t.vi) + '</span>' +
      '<span class="tile-foot">' + badge(l) + ring(E.masteryProgress(st, t.id)) + '</span>' +
      (st && st.refresh ? '<span class="refresh">needs a refresh</span>' : '') + '</a>';
  }

  /* ---------- visual lesson ---------- */
  function lessonBody(t) {
    var html = '<p class="rule">' + esc(t.rule) + '</p>';
    html += '<section class="slab machine" aria-label="Sentence pattern"><span class="machine-label">How the sentence is built</span>' +
      t.formula.map(chips).join('') + '</section>';
    if (t.timeline && t.timeline.length) html += '<section class="slab timeline" aria-label="Timeline"><div class="tl-wrap">' + timelineSvg(t.timeline) + '</div></section>';
    html += '<div class="pair">' + example('wrong', t.wrong) + example('right', t.right) + '</div>';
    html += '<aside class="tip"><b>Tip</b>' + esc(t.tip) + '</aside>';
    return html;
  }

  function example(kind, ex) {
    var tag = kind === 'wrong' ? 'del' : 'ins';
    var body = ex.parts.map(function (p) { return p.hl ? '<' + tag + '>' + esc(p.t) + '</' + tag + '>' : esc(p.t); }).join('');
    return '<div class="slab example ' + kind + '"><div class="example-head">' +
      (kind === 'wrong' ? '✗ Wrong' : '✓ Right') + '</div><p>' + body + '</p></div>';
  }

  function timelineSvg(items) {
    var narrow = window.innerWidth < 560;
    var W = narrow ? 380 : 640, L = narrow ? 24 : 40, R = W - (narrow ? 30 : 40);
    function x(v) { return L + (v + 1) / 2 * (R - L); }
    var spans = items.filter(function (i) { return i.kind === 'span'; });
    var points = items.filter(function (i) { return i.kind === 'point'; });
    var fills = [['var(--v-bg)', 'var(--v-ink)'], ['var(--s-bg)', 'var(--s-ink)'], ['var(--o-bg)', 'var(--o-ink)'], ['var(--x-bg)', 'var(--x-ink)']];
    var top = 16, rowH = 42;
    var axisY = top + spans.length * rowH + 22;
    var H = axisY + 78;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Timeline: ' +
      esc(items.map(function (i) { return i.label; }).join(', ')) + '">';
    var sorted = points.slice().sort(function (a, b) { return a.at - b.at; });
    sorted.forEach(function (p) {
      var px = x(p.at), isNow = p.at === 0 && /now/i.test(p.label);
      s += '<line x1="' + px + '" y1="' + (top - 6) + '" x2="' + px + '" y2="' + axisY + '" stroke="currentColor" stroke-width="1" stroke-dasharray="' + (isNow ? '0' : '3 4') + '" opacity="' + (isNow ? '.6' : '.35') + '"/>';
    });
    spans.forEach(function (sp, i) {
      var x1 = x(Math.min(sp.from, sp.to)), x2 = x(Math.max(sp.from, sp.to)), y = top + i * rowH;
      s += '<rect x="' + x1 + '" y="' + y + '" width="' + Math.max(10, x2 - x1) + '" height="30" rx="6" fill="' + fills[i % fills.length][0] + '"/>';
      s += '<text x="' + ((x1 + x2) / 2) + '" y="' + (y + 20) + '" text-anchor="middle" font-size="15" fill="' + fills[i % fills.length][1] + '">' + esc(sp.label) + '</text>';
    });
    s += '<line x1="' + L + '" y1="' + axisY + '" x2="' + R + '" y2="' + axisY + '" stroke="currentColor" stroke-width="1.5" opacity=".5"/>';
    s += '<path d="M' + (R + 10) + ' ' + axisY + ' L' + R + ' ' + (axisY - 5) + ' L' + R + ' ' + (axisY + 5) + 'Z" fill="currentColor" opacity=".5"/>';
    s += '<text class="end" x="' + L + '" y="' + (axisY + 70) + '" font-size="14" fill="currentColor" opacity=".7">past</text>';
    s += '<text class="end" x="' + (R + 10) + '" y="' + (axisY + 70) + '" font-size="14" text-anchor="end" fill="currentColor" opacity=".7">future</text>';
    sorted.forEach(function (p, i) {
      var px = x(p.at), isNow = p.at === 0 && /now/i.test(p.label);
      var close = i > 0 && px - x(sorted[i - 1].at) < (narrow ? 70 : 90);
      var ly = axisY + 32 + (close && i % 2 ? 20 : 0);
      s += '<circle cx="' + px + '" cy="' + axisY + '" r="6" fill="' + (isNow ? 'var(--accent)' : 'var(--bg)') + '" stroke="' + (isNow ? 'var(--accent)' : 'currentColor') + '" stroke-width="2"/>';
      s += '<text x="' + px + '" y="' + ly + '" text-anchor="middle" font-size="16" fill="currentColor">' + esc(p.label) + '</text>';
    });
    return s + '</svg>';
  }

  function kindCount(id) {
    var k = {};
    bank.byTopic[id].forEach(function (q) { k[q.kind] = 1; });
    var n = Object.keys(k).length;
    return n === 5 ? 'all five' : ['zero', 'one', 'two', 'three', 'four'][n];
  }

  function renderLesson(id) {
    var t = topic(id), st = state.topics[id], l = st ? st.level : 0, bp = bandParts(t);
    var html = masthead() + '<a class="btn btn-ghost back" href="#map">← Topic map</a>';
    html += '<article class="lesson"><header class="lesson-head">' +
      '<div class="lesson-meta"><span class="band-num">' + esc(bp.band) + '</span>' + badge(l) +
      (st ? '<span>' + st.correct + ' right of ' + st.answered + ' answered</span>' : '<span>Not started</span>') +
      (st && st.refresh ? '<span class="refresh">needs a refresh</span>' : '') + '</div>' +
      '<h1>' + esc(t.title) + '</h1><p class="lesson-vi" lang="vi">' + esc(t.vi) + '</p></header>' +
      lessonBody(t) +
      '<div class="lesson-actions"><button class="btn btn-mark btn-xl" data-act="start-topic" data-topic="' + esc(id) + '">Start practice</button>' +
      '<p>20 questions, ' + kindCount(id) + ' question types, about 8 minutes.</p></div></article>';
    app.innerHTML = html;
    animateChips();
    window.scrollTo(0, 0);
  }

  // First view: the chips arrive jumbled, then slide into the right order (FLIP).
  function animateChips() {
    if (REDUCED || !app.animate) return;
    var row = app.querySelector('.formula');
    if (!row || row.children.length < 2) return;
    var parts = Array.prototype.slice.call(row.children);
    var first = parts.map(function (p) { return p.getBoundingClientRect(); });
    var jumbled = parts.slice().reverse();
    if (jumbled.length > 2) jumbled.push(jumbled.shift());
    jumbled.forEach(function (p) { row.appendChild(p); });
    var mid = parts.map(function (p) { return p.getBoundingClientRect(); });
    parts.forEach(function (p) { row.appendChild(p); });
    parts.forEach(function (p, i) {
      var dx = mid[i].left - first[i].left, dy = mid[i].top - first[i].top;
      p.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px)', opacity: 0.4 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px)', opacity: 0.4, offset: 0.3 },
        { transform: 'none', opacity: 1 }
      ], { duration: 800, easing: 'cubic-bezier(.2,.7,.2,1)', delay: 40 * i });
    });
  }

  /* ---------- sessions ---------- */
  function startSession(opts) {
    session = new E.Session(bank, state, opts);
    ui = { item: null, answered: false, celebrate: [] };
    lastSummary = null;
    nextItem();
    go('practice');
  }

  function endSession(show) {
    if (!session) return;
    Store.flush();
    var s = session;
    lastSummary = { data: s.summary(), mode: s.mode, topic: s.topicId };
    lastSummary.session = s;
    session = null;
    stopTimer();
    if (show) go('results');
  }

  function nextItem() {
    ui.answered = false;
    ui.item = session.next();
    ui.result = null;
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(function () {
      var el = document.getElementById('m-time');
      if (el && session) el.textContent = clockText(session.elapsed());
      // Timed phases move on by themselves once their time is up, at the next question.
    }, 1000);
  }
  function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }

  function renderSession() {
    if (!ui.item) { endSession(true); return; }
    var s = session, item = ui.item;
    var answered = s.history.length;
    var right = s.history.filter(function (h) { return h.correct; }).length;
    var p = item.phase;
    var t = item.kind === 'lesson' ? topic(item.topic) : topic(item.view.q.topic);
    var phaseLabel = s.mode === 'topic' ? 'Topic practice' : s.mode === 'review' ? 'Review mistakes' : p.label;
    var total = s.mode === 'topic' ? s.target : s.mode === 'review' ? s.queue.length : null;

    var html = '<div class="sbar" role="region" aria-label="Session status">' +
      '<button class="btn" data-act="end">End</button>' +
      '<div class="where"><b>' + esc(t.title) + '</b><span>' + esc(phaseLabel) + '</span></div>' +
      '<div class="meters">' +
      '<div class="meter"><b id="m-time">' + clockText(s.elapsed()) + '</b><span>time</span></div>' +
      '<div class="meter"><b>' + answered + (total ? '/' + total : '') + '</b><span>done</span></div>' +
      '<div class="meter"><b>' + (answered ? pct(right / answered) : '–') + '</b><span>right</span></div></div>';
    if (s.mode === 'main') {
      html += '<div class="phases" aria-hidden="true">' + s.phases.map(function (ph, i) {
        return '<span class="' + (i < s.phaseIdx ? 'done' : i === s.phaseIdx ? 'now' : '') + '" title="' + esc(ph.label) + '"></span>';
      }).join('') + '</div>';
    }
    html += '</div><div class="stage">';

    if (item.kind === 'lesson') {
      html += '<article class="lesson"><header class="lesson-head"><div class="lesson-meta"><span class="band-num">Focus topic</span>' +
        badge(E.levelOf(state, t.id)) + '</div><h1>' + esc(t.title) + '</h1><p class="lesson-vi" lang="vi">' + esc(t.vi) + '</p></header>' +
        lessonBody(t) + '<div class="lesson-actions"><button class="btn btn-mark btn-xl" data-act="lesson-done" id="primary">Start questions</button></div></article>';
    } else {
      html += questionCard(item);
    }
    html += '</div>';
    app.innerHTML = html;
    if (item.kind === 'lesson') animateChips();
    startTimer();
    var focusEl = document.getElementById(ui.answered ? 'next-btn' : 'typed-input');
    if (focusEl) focusEl.focus({ preventScroll: true });
  }

  function promptHtml(q, filled) {
    var p = esc(q.prompt);
    if (q.kind === 'fix') return p.replace(/\[\[(.+?)\]\]/, '<mark>$1</mark>');
    if (q.kind === 'choose' || q.kind === 'type') {
      if (filled !== undefined) {
        var f = /^∅/.test(filled) ? '∅' : esc(filled);
        return p.replace('___', '<span class="gap filled">' + f + '</span>');
      }
      return p.replace('___', '<span class="gap" aria-label="gap">&nbsp;</span>');
    }
    return p;
  }

  function questionCard(item) {
    var v = item.view, q = v.q, done = ui.answered, res = ui.result;
    var html = '<article class="slab qcard" aria-labelledby="q-prompt"><div class="qtop">' +
      '<span class="qkind">' + KIND_LABEL[q.kind] + '</span>' +
      (item.isReview ? '<span class="review-tag">Review of an old mistake</span>' : '') +
      '<span class="qtopic">' + esc(topic(q.topic).title) + '</span></div>';

    var wholeSentence = q.kind === 'correct' || (q.kind === 'choose' && q.prompt.indexOf('___') < 0);
    var correctAns = q.kind === 'type' ? v.answer : v.options[v.answer];
    html += '<p id="q-prompt" class="prompt' + (wholeSentence ? ' small' : '') + '">' +
      promptHtml(q, done && !wholeSentence && (q.kind === 'choose' || q.kind === 'type') ? correctAns : undefined) + '</p>';

    if (q.kind === 'type') {
      html += '<form class="typed" data-form="type" autocomplete="off"><label for="typed-input" class="sr-only">Your answer</label>' +
        '<input id="typed-input" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"' +
        (done ? ' disabled value="' + esc(res.response) + '" class="' + (res.correct ? 'is-right' : 'is-wrong') + '"' : '') + '>' +
        (done ? '' : '<button class="btn btn-ink" type="submit">Check</button>') + '</form>';
    } else {
      var short = v.options.every(function (o) { return o.length <= 24; });
      var cls = q.kind === 'judge' ? 'opts two' : short ? 'opts short' : 'opts';
      html += '<div class="' + cls + '" role="group" aria-label="Answers">' + v.options.map(function (o, i) {
        var c = 'opt' + (q.kind === 'judge' ? ' judge' : '');
        var verdict = '';
        if (done) {
          if (i === v.answer) { c += ' is-right'; verdict = '<span class="verdict">✓ ' + (res.response === i ? 'Your answer' : 'Right answer') + '</span>'; }
          else if (i === res.response) { c += ' is-wrong'; verdict = '<span class="verdict">✗ Your answer</span>'; }
          else c += ' dim';
        }
        var label = /^∅/.test(o) ? '∅ leave it empty' : o;
        return '<button class="' + c + '" data-opt="' + i + '"' + (done ? ' disabled' : '') + '>' +
          '<kbd aria-hidden="true">' + (i + 1) + '</kbd><span class="txt">' + esc(label) + '</span>' + verdict + '</button>';
      }).join('') + '</div>';
    }

    html += '<div class="feedback" id="feedback" aria-live="polite">' + (done ? feedbackHtml(item) : '') + '</div>';
    if (done) {
      html += '<div class="next-row"><span class="hint">Press Enter for the next question</span>' +
        '<button class="btn btn-mark" id="next-btn" data-act="next">Next question</button></div>';
    } else if (q.kind !== 'type') {
      html += '<p class="next-row"><span class="hint">Keys 1–' + v.options.length + ' choose an answer</span></p>';
    }
    return html + '</article>';
  }

  function feedbackHtml(item) {
    var q = item.view.q, res = ui.result;
    var html = '<div class="verdict-line ' + (res.correct ? 'good' : 'bad') + '"><i aria-hidden="true">' + (res.correct ? '✓' : '✗') + '</i>' +
      (res.correct ? 'Correct' : 'Not quite') + '</div>';
    var explain = q.explain || '';
    if (q.kind === 'judge') {
      if (q.answer === 1) {
        html += '<p class="fixed"><small>This sentence is wrong. Correct version:</small>' + esc(q.fixed) + '</p>';
        explain = explain.replace('Incorrect. Correct version: ' + q.fixed, '').trim();
      } else {
        explain = explain.replace(/^Correct\.\s*/, 'This sentence is correct. ');
      }
    } else if (q.kind !== 'correct' && !(q.kind === 'choose' && q.prompt.indexOf('___') < 0)) {
      if (!res.correct || q.kind === 'fix') html += '<p class="fixed"><small>Correct sentence</small>' + esc(E.correctSentence(q)) + '</p>';
    }
    if (explain) html += '<p class="explain">' + esc(explain) + '</p>';
    return html;
  }

  function submitAnswer(response) {
    if (!session || !ui.item || ui.answered || ui.item.kind !== 'question') return;
    var item = ui.item;
    var r = session.answer(response);
    if (!r) return;
    ui.answered = true;
    ui.item = item;                    // keep showing the answered card
    ui.result = { correct: r.correct, response: response };
    if (r.change.mastered) ui.celebrate.push(r.change.topic);
    save();
    renderSession();
    announce((r.correct ? 'Correct. ' : 'Not quite. ') + (item.view.q.explain || ''));
    if (ui.celebrate.length) celebrate(ui.celebrate.shift());
  }

  function advance() {
    if (!session) return;
    nextItem();
    if (!ui.item) { endSession(true); return; }
    renderSession();
    window.scrollTo(0, 0);
  }

  function celebrate(id) {
    var t = topic(id);
    var o = document.createElement('div');
    o.className = 'overlay';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-label', 'Topic mastered');
    o.innerHTML = '<div class="stamp"><span class="big">Mastered</span><p><strong>' + esc(t.title) + '</strong><br>' +
      'You know this one now. It stays in your mixed rounds so it stays fresh.</p>' +
      '<button class="btn btn-mark" data-act="close-overlay" id="overlay-btn">Keep going</button></div>';
    document.body.appendChild(o);
    document.getElementById('overlay-btn').focus();
    announce(t.title + ' is now mastered.');
  }

  /* ---------- summary ---------- */
  function renderSummary() {
    var sm = lastSummary, d = sm.data;
    var html = masthead() + '<section class="summary"><h1>' + (d.answered ? 'Session done' : 'Session ended') + '</h1>';
    html += '<dl class="stats">' +
      '<div class="stat"><dt>minutes</dt><dd>' + Math.max(d.answered ? 1 : 0, Math.round(d.ms / 60000)) + '</dd></div>' +
      '<div class="stat"><dt>answered</dt><dd>' + d.answered + '</dd></div>' +
      '<div class="stat"><dt>right</dt><dd>' + (d.answered ? pct(d.accuracy) : '–') + '</dd></div>' +
      '<div class="stat"><dt>topics</dt><dd>' + Object.keys(d.topics).length + '</dd></div></dl>';

    if (d.changes.length) {
      html += '<div class="slab"><h2 class="box-title">Level changes</h2><ul class="list">' + d.changes.map(function (c) {
        var up = c.to > c.from;
        return '<li><span>' + esc(topic(c.topic).title) + '</span><span class="up">' + levelName(c.from) + ' → ' + levelName(c.to) +
          (up ? ' ▲' : ', needs a refresh') + '</span></li>';
      }).join('') + '</ul></div>';
    }

    var tids = Object.keys(d.topics);
    if (tids.length) {
      html += '<div class="slab"><h2 class="box-title">Topics practised</h2><ul class="list">' + tids.map(function (id) {
        var x = d.topics[id];
        return '<li><a href="#lesson-' + esc(id) + '">' + esc(topic(id).title) + '</a><span class="acc">' + x.correct + '/' + x.answered + '</span></li>';
      }).join('') + '</ul></div>';
    }

    if (d.mistakes.length) {
      html += '<div class="slab"><h2 class="box-title">Mistakes to review (' + d.mistakes.length + ')</h2><ul class="list">' +
        d.mistakes.slice(0, 30).map(function (m) {
          var q = m.q;
          var was = q.kind === 'judge' || q.kind === 'fix' ? q.prompt.replace(/\[\[|\]\]/g, '') :
            q.kind === 'correct' || q.prompt.indexOf('___') < 0 ? (typeof m.response === 'number' ? m.view.options[m.response] : q.prompt) : q.prompt;
          return '<li class="mistake"><span class="was">' + esc(was) + '</span><span class="now">' + esc(E.correctSentence(q)) + '</span></li>';
        }).join('') + '</ul></div>';
    }

    html += '<div class="cta-row">';
    if (sm.mode === 'main') html += '<button class="btn btn-mark btn-xl" data-act="extend">Add another round</button>';
    if (sm.mode === 'topic') html += '<button class="btn btn-mark btn-xl" data-act="start-topic" data-topic="' + esc(sm.topic) + '">Practise again</button>';
    if (E.reviewList(state, Date.now(), false).length && sm.mode !== 'review') html += '<button class="btn" data-act="review">Review mistakes</button>';
    html += '<a class="btn" href="#map">Back to topic map</a></div></section>';
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  /* ---------- events ---------- */
  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act], [data-opt]');
    if (!el) return;
    if (el.hasAttribute('data-opt')) { submitAnswer(Number(el.getAttribute('data-opt'))); return; }
    var act = el.getAttribute('data-act');
    if (act === 'theme') toggleTheme();
    else if (act === 'retry') boot();
    else if (act === 'start-main') startSession({ mode: 'main' });
    else if (act === 'review') startSession({ mode: 'review' });
    else if (act === 'start-topic') startSession({ mode: 'topic', topic: el.getAttribute('data-topic') });
    else if (act === 'lesson-done') { ui.item = session.continueAfterLesson(); ui.answered = false; renderSession(); window.scrollTo(0, 0); }
    else if (act === 'next') advance();
    else if (act === 'end') endSession(true);
    else if (act === 'extend') {
      var s = lastSummary && lastSummary.session;
      if (!s) return;
      s.extend();
      session = s;
      ui = { item: null, answered: false, celebrate: [] };
      nextItem();
      go('practice');
    }
    else if (act === 'reset-ask') {
      document.getElementById('reset-zone').innerHTML = 'Delete all progress? <button data-act="reset-yes">Yes, delete it</button> <button data-act="reset-no">Keep it</button>';
    }
    else if (act === 'reset-yes') { Store.reset(); state = E.emptyState(); renderMap(); }
    else if (act === 'reset-no') renderMap();
  });

  document.body.addEventListener('click', function (e) {
    if (e.target.closest('[data-act="close-overlay"]')) {
      var o = document.querySelector('.overlay');
      if (o) o.remove();
      var n = document.getElementById('next-btn');
      if (n) n.focus();
    }
  });

  app.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-form="type"]');
    if (!f) return;
    e.preventDefault();
    var input = document.getElementById('typed-input');
    if (!input.value.trim()) { input.focus(); return; }
    submitAnswer(input.value);
  });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var overlay = document.querySelector('.overlay');
    if (overlay) {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); overlay.remove(); var n = document.getElementById('next-btn'); if (n) n.focus(); }
      return;
    }
    if (!session || location.hash !== '#practice' || !ui.item) return;
    var typing = e.target && e.target.tagName === 'INPUT';
    if (ui.item.kind === 'lesson') {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A') { e.preventDefault(); app.querySelector('[data-act="lesson-done"]').click(); }
      return;
    }
    if (!ui.answered && !typing && /^[1-4]$/.test(e.key)) {
      var i = Number(e.key) - 1;
      if (ui.item.view.options.length > i) { e.preventDefault(); submitAnswer(i); }
      return;
    }
    if (ui.answered && e.key === 'Enter' && (e.target === document.body || e.target.id === 'next-btn' || typing)) {
      e.preventDefault();
      advance();
    }
  });

  boot();
})();
