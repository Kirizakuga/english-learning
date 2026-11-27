// Run with: node tests/engine.test.js
// Checks the anti-repetition rules (§5), mastery levels (§6) and answer matching.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const E = require('../js/engine.js');

const root = path.join(__dirname, '..');
const topics = JSON.parse(fs.readFileSync(path.join(root, 'data/topics.json'), 'utf8'));
const questions = JSON.parse(fs.readFileSync(path.join(root, 'data/questions.json'), 'utf8'));
const bank = E.createBank(topics, questions);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}

function fakeClock(start, stepMs) {
  let t = start;
  const clock = () => t;
  clock.tick = () => { t += stepMs; };
  return clock;
}

// Answer a question with a given probability of being right.
function respond(view, rng, pRight) {
  const right = rng() < pRight;
  if (view.q.kind === 'type') return right ? view.answer : 'zzz';
  return right ? view.answer : (view.answer + 1) % view.options.length;
}

function run(session, n, clock, rng, pRight, onQuestion) {
  let count = 0, guard = 0;
  while (count < n && guard++ < n * 3) {
    let item = session.next();
    if (!item) {
      if (session.mode === 'main') { session.extend(); item = session.next(); }
      if (!item) break;
    }
    if (item.kind === 'lesson') item = session.continueAfterLesson();
    if (onQuestion) onQuestion(item, count);
    session.answer(respond(item.view, rng, pRight));
    clock.tick();
    count++;
  }
  return count;
}

function checkSession(session, gap) {
  const h = session.history;
  const ids = new Set();
  const last = {};
  h.forEach((x, i) => {
    assert(!ids.has(x.id), 'id repeated in session: ' + x.id + ' at ' + i);
    ids.add(x.id);
    if (last[x.frame] !== undefined) {
      assert(i - last[x.frame] >= gap, `frame ${x.frame} repeated after ${i - last[x.frame]} questions (pos ${i})`);
    }
    last[x.frame] = i;
    if (i >= 3) {
      assert(!(h[i - 1].kind === x.kind && h[i - 2].kind === x.kind && h[i - 3].kind === x.kind),
        'more than 3 of kind ' + x.kind + ' in a row at ' + i);
    }
  });
}

test('300 answers in a 30-minute session: no frame within 25 questions', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const rng = E.mulberry32(seed);
    const state = E.emptyState();
    const clock = fakeClock(Date.UTC(2026, 0, 10), 6000);    // 6 s per answer → 300 answers ≈ 30 min
    const s = new E.Session(bank, state, { mode: 'main', clock, rng });
    const n = run(s, 300, clock, rng, 0.75);
    assert.strictEqual(n, 300, 'session stopped early at ' + n);
    checkSession(s, 25);
    const phases = new Set(s.history.map(h => h.phase));
    ['focus', 'mixed', 'boss'].forEach(p => assert(phases.has(p), 'phase missing: ' + p));
  }
});

test('300 answers in a mixed session with prior progress: frame gap 25', () => {
  const rng = E.mulberry32(42);
  const state = E.emptyState();
  const clock = fakeClock(Date.UTC(2026, 0, 10), 20000);
  // Warm the state: practise five topics first.
  ['ps-pc', 'qform', 'art', 'sva', 'past'].forEach(id => {
    const t = new E.Session(bank, state, { mode: 'topic', topic: id, clock, rng });
    run(t, 20, clock, rng, 0.8);
  });
  const s = new E.Session(bank, state, { mode: 'mixed', count: 300, clock, rng });
  const n = run(s, 300, clock, rng, 0.8);
  assert.strictEqual(n, 300);
  checkSession(s, 25);
});

test('20-question topic session: every frame once before repeats, repeats ≥ 8 apart, all kinds', () => {
  topics.forEach((tp, i) => {
    const rng = E.mulberry32(100 + i);
    const clock = fakeClock(Date.UTC(2026, 0, 10), 15000);
    const s = new E.Session(bank, E.emptyState(), { mode: 'topic', topic: tp.id, clock, rng });
    assert.strictEqual(run(s, 25, clock, rng, 0.7), 20, tp.id + ' did not give 20 questions');
    const frames = bank.framesOf[tp.id];
    const firstN = s.history.slice(0, frames.length).map(h => h.frame);
    assert.strictEqual(new Set(firstN).size, frames.length, tp.id + ': a frame repeated before all were used');
    checkSession(s, 8);
    const kinds = new Set(s.history.map(h => h.kind));
    const avail = new Set(bank.byTopic[tp.id].map(q => q.kind));
    assert.strictEqual(kinds.size, avail.size, tp.id + ': only kinds ' + [...kinds].join(','));
  });
});

test('review mode serves a different kind from the same frame', () => {
  const rng = E.mulberry32(7);
  const state = E.emptyState();
  const clock = fakeClock(Date.UTC(2026, 0, 10), 10000);
  const t = new E.Session(bank, state, { mode: 'topic', topic: 'qform', clock, rng });
  run(t, 20, clock, rng, 0);                    // answer everything wrong
  const wrong = {};
  t.history.forEach(h => { wrong[h.frame] = h.kind; });
  const r = new E.Session(bank, state, { mode: 'review', clock, rng });
  let served = 0;
  run(r, 50, clock, rng, 1, item => {
    served++;
    const q = item.view.q;
    assert(wrong[q.frame], 'review served a frame that was never missed');
    assert.notStrictEqual(q.kind, state.review[q.frame].kind, 'review repeated the same kind for ' + q.frame);
  });
  assert(served >= 10, 'too few review items: ' + served);
});

test('spaced review: 1 day, then 3 days; two right in a row clears it', () => {
  const state = E.emptyState();
  const q = bank.byTopic.art[0];
  const day0 = Date.UTC(2026, 0, 10);
  E.record(state, q, false, day0, false);
  assert.strictEqual(state.review[q.frame].due, day0 + E.DAY);
  E.record(state, q, true, day0 + E.DAY, true);
  assert.strictEqual(state.review[q.frame].due, day0 + E.DAY + 3 * E.DAY);
  E.record(state, q, true, day0 + 4 * E.DAY, true);
  assert(!state.review[q.frame], 'not cleared after two right answers');
});

test('mastery levels follow §6 and drop one level at a time', () => {
  const state = E.emptyState();
  const pool = bank.byTopic.sva;
  let now = Date.UTC(2026, 0, 10);
  const byKind = k => pool.filter(q => q.kind === k);
  assert.strictEqual(E.levelOf(state, 'sva'), 0);
  E.record(state, pool[0], false, now++, false);
  assert.strictEqual(E.levelOf(state, 'sva'), 1);
  for (let i = 0; i < 15; i++) E.record(state, byKind('judge')[i], true, now++, false);
  assert.strictEqual(E.levelOf(state, 'sva'), 2, 'should be Practised');
  for (let i = 0; i < 15; i++) E.record(state, byKind(['choose', 'fix', 'correct'][i % 3])[Math.floor(i / 3)], true, now++, false);
  assert.strictEqual(E.levelOf(state, 'sva'), 3, 'should be Mastered');
  for (let i = 0; i < 4; i++) E.record(state, pool[i], false, now++, false);
  assert.strictEqual(E.levelOf(state, 'sva'), 2, 'should drop to Practised');
  assert(state.topics.sva.refresh, 'refresh flag not set');
  const json = JSON.parse(JSON.stringify(state));
  assert.strictEqual(E.levelOf(E.normaliseState(json), 'sva'), 2, 'level lost after serialising');
});

test('typed answers are normalised', () => {
  const n = E.normaliseAnswer;
  assert.strictEqual(n('  Doesn’t   like. '), n("doesn't like"));
  assert.strictEqual(n('does not like'), n("doesn't like"));
  assert.strictEqual(n('Are Playing'), n('are playing'));
  assert.notStrictEqual(n('is playing'), n('are playing'));
});

test('weakest topics start with the priority list', () => {
  const w = E.weakest(E.emptyState(), bank, 3).map(x => x.id);
  assert.deepStrictEqual(w, ['qform', 'sva', 'splice']);
});

test('sync merge: newer topic wins, reviews and seen combine, reset sticks', () => {
  const day0 = Date.UTC(2026, 0, 10);
  const laptop = E.emptyState(), phone = E.emptyState();
  const art = bank.byTopic.art, sva = bank.byTopic.sva;
  E.record(laptop, art[0], false, day0, false);          // laptop: art, wrong
  E.record(phone, sva[0], true, day0 + 1000, false);     // phone: sva
  E.record(phone, art[1], true, day0 + 2000, false);     // phone: art, later
  const m = E.mergeStates(laptop, phone, day0 + 3000);
  assert.strictEqual(m.topics.art.answered, 1, 'newer art stats should win');
  assert.strictEqual(m.topics.art.correct, 1);
  assert(m.topics.sva, 'sva from phone missing');
  assert(m.review[art[0].frame], 'laptop review entry lost');
  assert(m.seen[art[0].id] && m.seen[art[1].id] && m.seen[sva[0].id], 'seen not combined');
  assert.strictEqual(m.answered, 2);
  // Clearing a review on one device is not undone by the other device's older copy.
  const cleared = JSON.parse(JSON.stringify(m));
  E.record(cleared, art[2], true, day0 + 5000, true);
  E.record(cleared, art[3], true, day0 + 6000, true);
  assert(!cleared.review[art[0].frame]);
  assert(!E.mergeStates(cleared, laptop, day0 + 7000).review[art[0].frame], 'cleared review came back');
  // Reset on one device wins over older data elsewhere.
  const reset = E.emptyState(); reset.resetAt = day0 + 8000;
  const r = E.mergeStates(reset, m, day0 + 9000);
  assert.strictEqual(Object.keys(r.topics).length, 0, 'reset was undone');
  assert.strictEqual(Object.keys(r.seen).length, 0);
});

test('sync document round-trips and stays small', () => {
  const rng = E.mulberry32(9), clock = fakeClock(Date.UTC(2026, 0, 10), 8000), state = E.emptyState();
  const s = new E.Session(bank, state, { mode: 'mixed', count: 400, clock, rng });
  run(s, 400, clock, rng, 0.7);
  bank.questions.forEach((q, i) => { if (i % 2) state.seen[q.id] = 1; });   // half the bank seen
  const doc = E.toRemote(state, bank);
  const size = JSON.stringify(doc).length;
  assert(size < 60000, 'sync document too big: ' + size);
  const back = E.fromRemote(JSON.parse(JSON.stringify(doc)), bank);
  assert.deepStrictEqual(Object.keys(back.seen).sort(), Object.keys(state.seen).sort());
  assert.deepStrictEqual(back.topics, state.topics);
});

console.log(`\n${passed} passed`);
