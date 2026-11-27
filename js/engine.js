/* Grammar to Band 9 — learning engine.
 * Pure logic: progress state, mastery levels, spaced review and the
 * anti-repetition picker. No DOM. Works in the browser (window.Engine)
 * and in Node (module.exports) so the rules can be tested. */
(function (root) {
  'use strict';

  var KINDS = ['choose', 'correct', 'judge', 'fix', 'type'];
  var LEVEL_NAMES = ['New', 'Learning', 'Practised', 'Mastered'];
  var PRIORITY = ['qform', 'sva', 'splice', 'punct', 'art', 'ger-inf', 'count'];
  var DAY = 86400000;
  var MIN = 60000;
  var REVIEW_DAYS = [1, 3, 7];
  var MIXED_GAP = 25;      // §5.2 mixed / 30-minute sessions
  var TOPIC_GAP = 8;       // §5.2 single-topic practice
  var KIND_RUN = 3;        // §5.5

  /* ---------- bank ---------- */

  var kindsAvail = {};   // topic id → number of kinds the bank has for it

  function createBank(topics, questions) {
    var bank = { topics: topics, questions: questions, byId: {}, byTopic: {}, byFrame: {}, topic: {}, framesOf: {} };
    topics.forEach(function (t) { bank.topic[t.id] = t; bank.byTopic[t.id] = []; bank.framesOf[t.id] = []; });
    questions.forEach(function (q) {
      bank.byId[q.id] = q;
      (bank.byTopic[q.topic] = bank.byTopic[q.topic] || []).push(q);
      if (!bank.byFrame[q.frame]) {
        bank.byFrame[q.frame] = [];
        (bank.framesOf[q.topic] = bank.framesOf[q.topic] || []).push(q.frame);
      }
      bank.byFrame[q.frame].push(q);
    });
    topics.forEach(function (t) {
      var k = {};
      (bank.byTopic[t.id] || []).forEach(function (q) { k[q.kind] = 1; });
      kindsAvail[t.id] = Object.keys(k).length;
    });
    return bank;
  }

  /* ---------- progress state ---------- */

  function emptyState() {
    return { v: 1, updatedAt: 0, topics: {}, review: {}, seen: {}, days: [], answered: 0, prefs: {} };
  }

  function normaliseState(s) {
    var base = emptyState();
    if (!s || typeof s !== 'object' || s.v !== 1) return base;
    Object.keys(base).forEach(function (k) { if (s[k] === undefined) s[k] = base[k]; });
    return s;
  }

  function topicStats(state, id) {
    var t = state.topics[id];
    if (!t) t = state.topics[id] = { answered: 0, correct: 0, last: [], kinds: {}, level: 0, refresh: false };
    return t;
  }

  function acc20(t) {
    if (!t || !t.last.length) return 0;
    var c = 0;
    for (var i = 0; i < t.last.length; i++) c += t.last[i];
    return c / t.last.length;
  }

  function kindsWith3(t) {
    return KINDS.filter(function (k) { return (t.kinds[k] || 0) >= 3; }).length;
  }

  // Mastered needs 3 kinds; a topic whose bank has fewer kinds (splice has 2) needs all of them.
  function kindsNeeded(id) { return Math.min(3, kindsAvail[id] || 3); }

  // The level the numbers alone would give (§6 table).
  function rawLevel(t, id) {
    if (!t || !t.answered) return 0;
    var a = acc20(t);
    if (t.correct >= 30 && a >= 0.85 && kindsWith3(t) >= kindsNeeded(id)) return 3;
    if (t.correct >= 15 && a >= 0.7) return 2;
    return 1;
  }

  function levelOf(state, id) {
    var t = state.topics[id];
    return t ? t.level : 0;
  }

  // 0..1 progress towards Mastered, the average of the three Mastered criteria.
  function masteryProgress(t, id) {
    if (!t || !t.answered) return 0;
    if (t.level === 3) return 1;
    var p = Math.min(t.correct / 30, 1) + Math.min(acc20(t) / 0.85, 1) + Math.min(kindsWith3(t) / kindsNeeded(id), 1);
    return Math.min(p / 3, 0.97);
  }

  function dayKey(now) {
    var d = new Date(now);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function streak(state, now) {
    var set = {};
    state.days.forEach(function (d) { set[d] = 1; });
    var n = 0, t = now;
    if (!set[dayKey(t)]) t -= DAY;            // yesterday still counts until today ends
    while (set[dayKey(t)]) { n++; t -= DAY; }
    return n;
  }

  /* Record one answer. Returns level change info for the UI. */
  function record(state, q, correct, now, isReview) {
    var t = topicStats(state, q.topic);
    var before = t.level;
    t.answered++;
    state.answered = (state.answered || 0) + 1;
    if (correct) { t.correct++; t.kinds[q.kind] = (t.kinds[q.kind] || 0) + 1; }
    t.last.push(correct ? 1 : 0);
    if (t.last.length > 20) t.last.shift();

    var raw = rawLevel(t, q.topic);
    if (raw > t.level) { t.level = raw; t.refresh = false; }
    else if (raw < t.level) { t.level -= 1; t.refresh = true; }   // drop gently, one level at a time

    // spaced review, one entry per frame (§5.4)
    var r = state.review[q.frame];
    if (!correct) {
      state.review[q.frame] = { frame: q.frame, topic: q.topic, kind: q.kind, id: q.id, step: 0, ok: 0, due: now + DAY };
    } else if (r && isReview) {
      r.ok++;
      if (r.ok >= 2) delete state.review[q.frame];
      else { r.step = Math.min(r.step + 1, REVIEW_DAYS.length - 1); r.due = now + REVIEW_DAYS[r.step] * DAY; r.kind = q.kind; r.id = q.id; }
    }

    state.seen[q.id] = 1;
    var dk = dayKey(now);
    if (state.days[state.days.length - 1] !== dk) {
      state.days.push(dk);
      if (state.days.length > 400) state.days.shift();
    }
    state.updatedAt = now;
    return { topic: q.topic, before: before, after: t.level, mastered: before < 3 && t.level === 3 };
  }

  function reviewList(state, now, dueOnly) {
    return Object.keys(state.review).map(function (k) { return state.review[k]; })
      .filter(function (r) { return !dueOnly || r.due <= now; })
      .sort(function (a, b) { return a.due - b.due; });
  }

  /* §6 weakest topics, with the user's priority topics boosted until Practised. */
  function weakest(state, bank, n) {
    var scored = [];
    bank.topics.forEach(function (tp) {
      var lvl = levelOf(state, tp.id);
      var prio = PRIORITY.indexOf(tp.id) >= 0 && lvl < 2;
      var t = state.topics[tp.id];
      if (lvl === 1) scored.push({ id: tp.id, score: acc20(t) - (prio ? 0.3 : 0), why: prio ? 'mistake' : 'weak' });
      else if (lvl === 0 && prio) scored.push({ id: tp.id, score: 0.45 + PRIORITY.indexOf(tp.id) * 0.01, why: 'mistake' });
    });
    scored.sort(function (a, b) { return a.score - b.score; });
    var out = scored.slice(0, n);
    for (var i = 0; out.length < n && i < bank.topics.length; i++) {
      var id = bank.topics[i].id;
      if (levelOf(state, id) === 0 && !out.some(function (o) { return o.id === id; })) out.push({ id: id, score: 1, why: 'new' });
    }
    return out;
  }

  /* ---------- answers ---------- */

  function normaliseAnswer(s) {
    return String(s)
      .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
      .toLowerCase().trim().replace(/\s+/g, ' ').replace(/\.$/, '').trim()
      .replace(/\bwon't\b/g, 'will not').replace(/\bcan't\b/g, 'cannot').replace(/\bcan not\b/g, 'cannot')
      .replace(/n't\b/g, ' not').replace(/'m\b/g, ' am').replace(/'re\b/g, ' are')
      .replace(/'ve\b/g, ' have').replace(/'ll\b/g, ' will').replace(/\s+/g, ' ');
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // A view of a question with options reshuffled and answer remapped (§5.6).
  // Judge keeps Correct / Incorrect in a fixed order: the label is the meaning.
  function present(q, rng) {
    if (q.kind === 'type') return { q: q, options: [], answer: q.answer };
    if (q.kind === 'judge') return { q: q, options: q.options.slice(), answer: q.answer };
    var order = shuffle(q.options.map(function (_, i) { return i; }), rng);
    return { q: q, options: order.map(function (i) { return q.options[i]; }), answer: order.indexOf(q.answer) };
  }

  function grade(view, response) {
    if (view.q.kind === 'type') return normaliseAnswer(response) === normaliseAnswer(view.answer);
    return response === view.answer;
  }

  // The full correct sentence, for feedback.
  function correctSentence(q) {
    if (q.kind === 'judge') return q.fixed || q.prompt;
    if (q.kind === 'correct') return q.options[q.answer];
    var ans = q.kind === 'type' ? q.answer : q.options[q.answer];
    if (q.kind === 'fix') {
      if (/^no change/i.test(ans)) return q.prompt.replace(/\[\[|\]\]/g, '');
      return tidy(q.prompt.replace(/\[\[[^\]]*\]\]/, isEmpty(ans) ? '' : ans));
    }
    if (q.prompt.indexOf('___') < 0) return ans;   // whole-sentence options
    return tidy(q.prompt.replace('___', isEmpty(ans) ? '' : ans));
  }
  function isEmpty(a) { return /^∅/.test(a); }
  function tidy(s) { return s.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim(); }

  /* ---------- sessions ---------- */

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function Session(bank, state, opts) {
    this.bank = bank;
    this.state = state;
    this.mode = opts.mode;                    // 'topic' | 'main' | 'review' | 'mixed'
    this.clock = opts.clock || Date.now;
    this.rng = opts.rng || Math.random;
    this.start = this.clock();
    this.history = [];                        // {id, frame, kind, topic, correct, phase}
    this.used = {};
    this.frameLast = {};
    this.frameUses = {};
    this.kindUses = {};
    this.lessonsShown = {};
    this.results = [];
    this.levelStart = {};
    this.levelEnd = {};
    this.pending = null;
    this.done = false;
    var self = this;
    bank.topics.forEach(function (t) { self.levelStart[t.id] = levelOf(state, t.id); });

    if (this.mode === 'topic') {
      this.topicId = opts.topic;
      this.target = opts.count || 20;
      this.phases = [{ key: 'topic', label: 'Practice', count: this.target }];
    } else if (this.mode === 'review') {
      this.queue = reviewList(state, this.clock(), false).slice(0, opts.count || 30);
      this.phases = [{ key: 'review', label: 'Review', count: this.queue.length }];
    } else if (this.mode === 'mixed') {
      this.phases = [{ key: 'mixed', label: 'Mixed', count: opts.count || 300 }];
      this.focus = weakest(state, bank, 2).map(function (w) { return w.id; });
    } else {
      this.focus = opts.focus || weakest(state, bank, 2).map(function (w) { return w.id; });
      this.queue = reviewList(state, this.clock(), true);
      this.phases = [
        { key: 'warm', label: 'Warm-up', minutes: 5, max: 20 },
        { key: 'focus', label: 'Focus', minutes: 15 },
        { key: 'mixed', label: 'Mixed', minutes: 8 },
        { key: 'boss', label: 'Boss round', count: 5 }
      ];
    }
    this.phaseIdx = 0;
    this.phaseStart = this.start;
    this.phaseAnswers = 0;
    this.focusBand = this.focus && this.focus.length
      ? Math.max.apply(null, this.focus.map(function (id) { return bank.topic[id].band; })) : 1;
  }

  Session.prototype.phase = function () { return this.phases[this.phaseIdx]; };

  Session.prototype.elapsed = function () { return this.clock() - this.start; };

  Session.prototype.plannedMinutes = function () {
    return this.phases.reduce(function (s, p) { return s + (p.minutes || (p.count ? p.count * 0.4 : 0)); }, 0);
  };

  // Add another round to a 30-minute session.
  Session.prototype.extend = function () {
    this.phases.push({ key: 'mixed', label: 'Extra mixed', minutes: 8 }, { key: 'boss', label: 'Boss round', count: 5 });
    if (this.phaseIdx >= this.phases.length - 2) { this.phaseIdx = this.phases.length - 2; }
    this.phaseStart = this.clock();
    this.phaseAnswers = 0;
    this.done = false;
  };

  Session.prototype.phaseOver = function () {
    var p = this.phase();
    if (!p) return true;
    if (p.key === 'warm') {
      var due = this.queue.filter(function (r) { return !this.used['f:' + r.frame]; }, this);
      if (!due.length || this.phaseAnswers >= p.max) return true;
    }
    if (p.key === 'review') return this.phaseAnswers >= this.queue.length;
    if (p.count && this.phaseAnswers >= p.count) return true;
    if (p.minutes && this.clock() - this.phaseStart >= p.minutes * MIN) return true;
    return false;
  };

  Session.prototype.advancePhase = function () {
    while (this.phase() && this.phaseOver()) {
      this.phaseIdx++;
      this.phaseStart = this.clock();
      this.phaseAnswers = 0;
    }
    if (!this.phase()) this.done = true;
  };

  /* Core picker. Applies §5 rules 1, 2, 3 and 5 to one pool. */
  Session.prototype.pickFrom = function (pool, gap, topicRule) {
    var pos = this.history.length, self = this;
    var h = this.history;
    var runKind = null;
    if (h.length >= KIND_RUN) {
      var k = h[h.length - 1].kind, same = true;
      for (var i = 2; i <= KIND_RUN; i++) if (h[h.length - i].kind !== k) same = false;
      if (same) runKind = k;
    }
    var cands = pool.filter(function (q) {
      if (self.used[q.id]) return false;
      var last = self.frameLast[q.frame];
      return last === undefined || pos - last >= gap;
    });
    if (!cands.length) return null;

    if (topicRule) {
      // Use every frame once before any frame repeats.
      var minUse = Infinity;
      pool.forEach(function (q) { if (!self.used[q.id]) minUse = Math.min(minUse, self.frameUses[q.frame] || 0); });
      var fresh = cands.filter(function (q) { return (self.frameUses[q.frame] || 0) === minUse; });
      if (fresh.length) cands = fresh;
    }
    var notRun = cands.filter(function (q) { return q.kind !== runKind; });
    if (notRun.length) cands = notRun;
    var unseen = cands.filter(function (q) { return !self.state.seen[q.id]; });
    if (unseen.length) cands = unseen;

    // Balance kinds: take the kind used least so far this session.
    var best = Infinity, kinds = {};
    cands.forEach(function (q) { kinds[q.kind] = 1; });
    Object.keys(kinds).forEach(function (k2) { best = Math.min(best, self.kindUses[k2] || 0); });
    var low = Object.keys(kinds).filter(function (k2) { return (self.kindUses[k2] || 0) === best; });
    var kind = low[Math.floor(this.rng() * low.length)];
    cands = cands.filter(function (q) { return q.kind === kind; });
    return cands[Math.floor(this.rng() * cands.length)];
  };

  Session.prototype.pickChain = function (pools, gap, topicRule) {
    for (var i = 0; i < pools.length; i++) {
      var q = this.pickFrom(pools[i], gap, topicRule);
      if (q) return q;
    }
    // Last resort: relax spacing rather than stop (never needed with the full bank).
    for (var g = gap - 1; g >= 1; g--) {
      var q2 = this.pickFrom(pools[pools.length - 1], g, false);
      if (q2) return q2;
    }
    return null;
  };

  // A review: same frame, a different kind from the one missed (§5.4).
  Session.prototype.pickReview = function (entry) {
    var self = this, last = this.history[this.history.length - 1];
    var items = (this.bank.byFrame[entry.frame] || []).filter(function (q) { return !self.used[q.id]; });
    if (!items.length) return null;
    var tries = [
      function (q) { return q.kind !== entry.kind && (!last || q.kind !== last.kind); },
      function (q) { return q.kind !== entry.kind; },
      function () { return true; }
    ];
    for (var i = 0; i < tries.length; i++) {
      var c = items.filter(tries[i]);
      if (c.length) {
        var unseen = c.filter(function (q) { return !self.state.seen[q.id]; });
        if (unseen.length) c = unseen;
        return c[Math.floor(this.rng() * c.length)];
      }
    }
    return null;
  };

  Session.prototype.topicPool = function (ids) {
    var bank = this.bank, out = [];
    ids.forEach(function (id) { out = out.concat(bank.byTopic[id] || []); });
    return out;
  };

  Session.prototype.mixedTopics = function () {
    var state = this.state, ids = [], seen = {};
    function add(id) { if (!seen[id]) { seen[id] = 1; ids.push(id); } }
    this.bank.topics.forEach(function (t) { var l = levelOf(state, t.id); if (l === 1 || l === 2) add(t.id); });
    (this.focus || []).forEach(add);
    // Keep at least ~4 topics so frame spacing has room; add started, then next new topics.
    var self = this;
    this.bank.topics.forEach(function (t) { if (ids.length < 4 && levelOf(state, t.id) > 0) add(t.id); });
    this.bank.topics.forEach(function (t) { if (ids.length < 4 && t.band <= self.focusBand) add(t.id); });
    return ids;
  };

  /* Next item: {kind:'question', view, phase, isReview} or {kind:'lesson', topic} or null. */
  Session.prototype.next = function () {
    if (this.pending) return this.pending;
    if (this.mode !== 'topic') this.advancePhase();
    else if (this.history.length >= this.target) this.done = true;
    if (this.done) return null;

    var p = this.phase(), q = null, isReview = false, all = this.bank.questions;
    if (p.key === 'topic') {
      var nFrames = (this.bank.framesOf[this.topicId] || []).length;
      q = this.pickChain([this.bank.byTopic[this.topicId]], Math.min(TOPIC_GAP, Math.max(1, nFrames - 1)), true);
    } else if (p.key === 'warm' || p.key === 'review') {
      while (this.queue.length && !q) {
        var entry = this.queue.find(function (r) { return !this.used['f:' + r.frame]; }, this);
        if (!entry) break;
        this.used['f:' + entry.frame] = 1;
        var last = this.frameLast[entry.frame];
        if (last !== undefined && this.history.length - last < MIXED_GAP && p.key === 'warm') continue;
        q = this.pickReview(entry);
      }
      isReview = !!q;
      if (!q) { this.phaseIdx++; this.phaseStart = this.clock(); this.phaseAnswers = 0; return this.next(); }
    } else if (p.key === 'focus') {
      var half = this.clock() - this.phaseStart < (p.minutes * MIN) / 2;
      var order = this.focus.length > 1 && !half ? [this.focus[1], this.focus[0]] : this.focus.slice();
      var pools = order.map(function (id) { return this.bank.byTopic[id]; }, this);
      pools.push(this.topicPool(this.mixedTopics()), all);
      q = this.pickChain(pools, MIXED_GAP, false);
    } else if (p.key === 'mixed') {
      q = this.pickChain([this.topicPool(this.mixedTopics()), all], MIXED_GAP, false);
    } else if (p.key === 'boss') {
      var band = this.focusBand;
      var bossTopics = this.bank.topics.filter(function (t) { return t.band >= band; }).map(function (t) { return t.id; });
      q = this.pickChain([this.topicPool(bossTopics), all], MIXED_GAP, false);
    }
    if (!q) { this.done = true; return null; }

    // Focus topics open with their visual lesson the first time they appear.
    if (this.mode === 'main' && this.focus.indexOf(q.topic) >= 0 && !this.lessonsShown[q.topic] && p.key === 'focus') {
      this.lessonsShown[q.topic] = 1;
      this.pending = { kind: 'lesson', topic: q.topic, phase: p, then: { q: q, isReview: isReview } };
      return this.pending;
    }
    return this.serve(q, isReview, p);
  };

  Session.prototype.serve = function (q, isReview, p) {
    this.used[q.id] = 1;
    this.pending = { kind: 'question', view: present(q, this.rng), phase: p, isReview: isReview };
    return this.pending;
  };

  // Called after a lesson card in the session has been read.
  Session.prototype.continueAfterLesson = function () {
    var l = this.pending;
    this.pending = null;
    if (!l || l.kind !== 'lesson') return this.next();
    return this.serve(l.then.q, l.then.isReview, l.phase);
  };

  Session.prototype.answer = function (response) {
    var item = this.pending;
    if (!item || item.kind !== 'question') return null;
    var q = item.view.q;
    var ok = grade(item.view, response);
    var change = record(this.state, q, ok, this.clock(), item.isReview);
    var pos = this.history.length;
    this.history.push({ id: q.id, frame: q.frame, kind: q.kind, topic: q.topic, correct: ok, phase: item.phase.key });
    this.frameLast[q.frame] = pos;
    this.frameUses[q.frame] = (this.frameUses[q.frame] || 0) + 1;
    this.kindUses[q.kind] = (this.kindUses[q.kind] || 0) + 1;
    this.phaseAnswers++;
    this.results.push({ q: q, correct: ok, response: response, view: item.view });
    this.levelEnd[q.topic] = change.after;
    this.pending = null;
    return { correct: ok, change: change };
  };

  Session.prototype.summary = function () {
    var self = this, topics = {}, correct = 0;
    this.results.forEach(function (r) {
      topics[r.q.topic] = topics[r.q.topic] || { answered: 0, correct: 0 };
      topics[r.q.topic].answered++;
      if (r.correct) { topics[r.q.topic].correct++; correct++; }
    });
    var changes = Object.keys(this.levelEnd).map(function (id) {
      return { topic: id, from: self.levelStart[id], to: self.levelEnd[id] };
    }).filter(function (c) { return c.from !== c.to; });
    return {
      answered: this.results.length,
      correct: correct,
      accuracy: this.results.length ? correct / this.results.length : 0,
      ms: this.elapsed(),
      topics: topics,
      changes: changes,
      mistakes: this.results.filter(function (r) { return !r.correct; })
    };
  };

  var Engine = {
    KINDS: KINDS, LEVEL_NAMES: LEVEL_NAMES, PRIORITY: PRIORITY, DAY: DAY, MIXED_GAP: MIXED_GAP, TOPIC_GAP: TOPIC_GAP,
    createBank: createBank, emptyState: emptyState, normaliseState: normaliseState,
    topicStats: topicStats, acc20: acc20, kindsNeeded: kindsNeeded, rawLevel: rawLevel, levelOf: levelOf, masteryProgress: masteryProgress,
    record: record, reviewList: reviewList, weakest: weakest, streak: streak, dayKey: dayKey,
    normaliseAnswer: normaliseAnswer, present: present, grade: grade, correctSentence: correctSentence,
    Session: Session, mulberry32: mulberry32
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : this);
