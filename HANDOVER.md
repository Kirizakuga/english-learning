# Handover: Grammar to Band 9 — learning-progress web app

You are building a grammar-learning web app for **Hiếu**, a Vietnamese IT student preparing for IELTS (current level around 6.5; goal 9.0). The **question database is finished and included**. Your job is the app: the topic map, visual lessons, practice sessions and mastery tracking.

Read this whole file before writing code. Decisions marked **(decided)** came from the user. Don't change them without asking.

---

## 1. What the user asked for

| Requirement | Detail |
|---|---|
| Cover all grammar needed for Band 9 **(decided)** | 44 topics in 4 bands, from Foundation to Mastery. Already in the data. |
| A big, fixed bank **(decided)** | 5,407 questions. No AI-generated questions at runtime. |
| Not repetitive **(decided)** | The user worried that "if we keep doing the same thing again and again… the learning means nothing". The app must actively avoid repeats (see §5). |
| Visual lessons **(decided)** | "I want the grammar to be expressed visually, not just in words." Lessons should be diagrams, colour-coded sentence blocks and timelines, not paragraphs. |
| Mastery levels **(decided)** | Each topic shows New → Learning → Practised → Mastered. |
| Long sessions **(decided)** | A typical session is 30+ minutes. |
| Reading level | UI text in plain, simple English (B1–B2). Vietnamese appears only as small side labels (each topic has a `vi` title). |

---

## 2. Files in this package

```
data/
  questions.json   5,407 questions, a JSON array with one record per line (~1.6 MB)
  topics.json      44 topics with lesson content (rule, formula, examples, timeline)
  meta.json        role names, band labels, counts
source/
  bank_a.txt       Band 5–6 topics (hand-written source sentences)
  bank_b.txt       Band 6.5–7 topics
  bank_c.txt       Band 7.5–9 topics
  build.py         regenerates data/ from the bank files (run `python3 build.py` inside source/; it rewrites data/)
HANDOVER.md        this file
```

**Don't edit the JSON by hand.** To add or fix questions, edit `source/bank_*.txt` and rerun `build.py`. The bank format is documented in §7.

---

## 3. Data schema

### topics.json (one record per topic, sorted by band)

```jsonc
{
  "id": "qform",                        // stable topic id
  "band": 1,                            // 1..4
  "bandLabel": "Band 5–6 · Foundation",
  "title": "Making questions",
  "vi": "Cách đặt câu hỏi",             // Vietnamese title for a small side label
  "rule": "Most questions need a helper verb before the subject …",
  "formula": [                          // one or more rows of colour-coded chips
    [ {"role":"x","text":"Wh-word"}, {"role":"aux","text":"do / does / is / can"},
      {"role":"s","text":"subject"}, {"role":"v","text":"main verb"}, {"role":"o","text":"...?"} ]
  ],
  "wrong": {"text":"How to change the language?", "parts":[{"t":"How to","hl":true},{"t":" change the language?","hl":false}]},
  "right": {"text":"How do I change the language?", "parts":[{"t":"How do I","hl":true}, …]},
  "tip": "\"How to...?\" is not a full question. Say \"How do I...?\" …",
  "timeline": [                         // [] for non-tense topics
    {"kind":"span","from":-0.8,"to":-0.3,"label":"was cooking"},
    {"kind":"point","at":-0.5,"label":"rang"},
    {"kind":"point","at":0,"label":"now"}
  ],
  "frameCount": 13, "questionCount": 140
}
```

- **Roles** (`meta.json → roles`): `s` subject, `aux` helper verb, `v` verb, `o` object/word, `x` time/extra, `c` connector. Give each role one fixed colour and use it everywhere, in lessons and when highlighting answers.
- **timeline** positions run from −1 (far past) through 0 (now) to +1 (future). `span` is a bar and `point` is a marker. Only the tense topics have one.
- `wrong` / `right` parts with `hl: true` are the bit that changes. Show them as a ✗ → ✓ pair with the changed part highlighted.

### questions.json (one record per question)

```jsonc
{"kind":"fix", "prompt":"My brother [[live]] in Da Nang, but this month he is staying with us.",
 "options":["No change needed","lives","living","is living"], "answer":1,
 "id":"ps-pc-09-fix1", "topic":"ps-pc", "frame":"ps-pc-09",
 "explain":"A permanent situation → present simple."}
```

| kind | Count | What the learner does | `answer` |
|---|---|---|---|
| `choose` | 553 | Pick the word/phrase for the `___` gap (or, for whole-sentence items, pick the correct sentence) | option index |
| `correct` | 539 | "Which sentence is correct?" from 4 full sentences | option index |
| `judge` | 2,199 | Decide whether the sentence is Correct or Incorrect | 0 = Correct, 1 = Incorrect |
| `fix` | 1,591 | The part in `[[…]]` is wrong: pick the replacement | option index |
| `type` | 525 | Type the missing word(s) for `___` | the expected string |

Notes:
- `[[…]]` in a `fix` prompt marks the wrong part. Render it highlighted and strip the brackets.
- `∅ (no article)` / `∅ (nothing)` is an option meaning "leave the gap empty".
- `judge` explanations already start with "Correct." or "Incorrect. Correct version: …".
- For `type`, compare after trimming, collapsing spaces, lowercasing and normalising curly quotes (’ → '). Accept answers that differ only by a final full stop.
- **`frame`** groups every question built from the same source sentence (about 10 per frame). Use it for anti-repetition (§5).
- Ids are stable as long as the bank files keep their line order. If questions are added later, append them at the end of a topic's block so existing ids don't shift.

---

## 4. Screens

### 4.1 Topic map (home)
- Four bands as sections, with a tile for each topic showing title, `vi` subtitle, mastery level badge and a progress ring.
- Header: overall stats (topics mastered out of 44, questions answered, current streak) and one big **Start session** button.
- A small **Suggested next** strip with the 3 weakest topics, using the rule in §6.

### 4.2 Visual lesson (per topic)
Render it from `topics.json`, with no extra prose:
1. **Formula**: each row of chips as a coloured "sentence machine", with the role name under each chip.
2. **Timeline** (tense topics only): an SVG line from past → now → future, with spans as bars and points as markers.
3. **✗ / ✓ pair**: the `wrong` and `right` sentences, with the changed part highlighted (struck through in ✗, coloured in ✓).
4. **Tip**: one short callout.
5. **Start practice** button, which opens a topic session.

Nice to have: animate the chips sliding into order on first view (honour `prefers-reduced-motion`).

### 4.3 Practice session
- One question at a time, in a large card. Show options as big buttons, using the number keys 1–4 for options and Enter for Next.
- After answering, show right/wrong straight away, highlight the correct option, then show `explain`. For `judge` items marked Incorrect, also show the corrected sentence.
- Top bar: topic name, session timer, question count, accuracy so far.
- At the end: a summary with topics practised, accuracy, levels gained and mistakes to review.

### 4.4 Session modes
- **Topic practice**: about 20 questions from one topic, mixing all five kinds.
- **30-minute session (main mode)**: a timed, mixed session:
  1. Warm-up (≈5 min): items you got wrong before (spaced review).
  2. Focus (≈15 min): 1–2 weakest topics, each starting with its visual lesson.
  3. Mixed (≈8 min): interleaved questions from topics at Learning or Practised level.
  4. Boss round (≈2 min): 5 items from any band at or above the current focus band.
  The user can extend the session by another round.
- **Review mistakes**: only items answered wrong and not yet fixed.

---

## 5. Anti-repetition rules (the user cares about this most)

1. Never show the same `id` twice in one session.
2. **Space out items from the same `frame`.** They share a source sentence, so back-to-back items feel repetitive. In mixed and 30-minute sessions, keep two items from the same frame at least 25 questions apart. Single-topic practice has only about 12 frames, so there the rule is: use every frame of the topic once before any frame repeats, and keep repeats at least 8 questions apart.
3. Prefer unseen items. Only reuse a seen item when every item for that topic has been seen, or when it's due for spaced review (rule 4).
4. A wrong answer goes into a review queue. Bring it back after 1 day, then 3 days, then 7. Getting it right twice in a row clears it. Wherever possible, serve the review as a *different kind* from the same frame (wrong `choose` → later `fix` or `judge`), so the learner meets the rule again, not the same screen.
5. Mix kinds: at most 3 items of the same `kind` in a row.
6. Shuffle option order each time an item is shown, and remap `answer`. The order stored in the file is already random, but reshuffling stops position memory.

---

## 6. Mastery levels

Track per topic: `answered`, `correct`, the last 20 results, and correct counts per `kind`.

| Level | Rule |
|---|---|
| **New** | 0 answered |
| **Learning** | answered ≥ 1, below Practised |
| **Practised** | ≥ 15 correct **and** accuracy of the last 20 ≥ 70% |
| **Mastered** | ≥ 30 correct **and** accuracy of the last 20 ≥ 85% **and** ≥ 3 correct in at least 3 different kinds |

- Levels can drop. If accuracy of the last 20 falls below the threshold, the topic drops one level. The UI should show this gently ("needs a refresh"), not as a failure.
- Show a small celebration when a topic reaches Mastered.
- **Weakest topics** (for Suggested next and Focus): prefer topics at Learning with the lowest recent accuracy. If none have been started, take the next New topic in band order.

**Priority topics for this user.** These are his most repeated real mistakes, so boost them in Suggested next until they're Practised: `qform` (questions without do/does/is), `sva` (it work / this one look), `splice` (comma splices), `punct` (lowercase "i", space before "?"), `art` (an master), `ger-inf` (how about + -ing), `count` (some + plural).

---

## 7. Extending the bank

Each topic in `source/bank_*.txt` starts with a header line, followed by one source sentence per line:

```
@id|band|title|vi|rule|FORMULA...|wrong|right|tip|timeline
sentence with ___ | answer | distractor ;; distractor ;; distractor | explanation
```

- `{P}` in a sentence is replaced with two different names, which gives two variants.
- A sentence that is just `___` means the options are whole sentences.
- A distractor prefixed with `~` is wrong only next to the best answer, so it's never used in `judge`/`fix` on its own. Example: "She is *the* honest person" is fine English in some contexts.
- `[[…]]` in the wrong/right fields marks the highlighted part.
- Run `python3 build.py`. It validates the data: 3 distractors per line, no duplicate options, the answer not among the distractors, unique ids.

---

## 8. Technical notes

- The app must work as a **static site**: load `topics.json` and `questions.json` with `fetch()`. The questions file is 1.6 MB, so load it once and keep it in memory. Show a loading state while it loads.
- **Progress storage**: store progress as a single JSON object behind one small storage module, so the backend can be swapped. Start with `localStorage` wrapped in try/catch, and the app must still work if storage fails. The user studies on both a laptop and a phone, so plan for sync: keep the shape serialisable, include `updatedAt`, and keep it small (per-topic stats + review queue + seen-id set).
- **If you publish it as a claude.ai artifact**: the page runs sandboxed. There's no `alert`/`confirm`, scripts may only come from cdnjs/jsdelivr/unpkg, other hosts are blocked, and fonts must come from Google Fonts. Publish `index.html` together with the two JSON files and fetch them by relative path. For cross-device progress, the artifact `db` capability can replace localStorage.
- **Mobile first**: the user often studies on a phone. Use 44 px tap targets, have no horizontal scroll at 360 px, and keep the practice card readable with one hand.
- **Accessibility**: support the keyboard throughout, make correct/incorrect clear without relying on colour alone (✓ / ✗ icons plus text), and use `aria-live` for feedback.
- Support both light and dark themes.

## 9. Definition of done

- [ ] All 44 topics appear on the map, grouped by band, with live mastery badges.
- [ ] Each topic's visual lesson renders formula chips, the ✗/✓ pair, the tip, and a timeline where there is one.
- [ ] All five question kinds work, including typed answers with normalisation.
- [ ] The 30-minute session follows the 4 phases, and the timer works.
- [ ] The anti-repetition rules in §5 hold. Test this by simulating 300 answers in a mixed session and asserting that no frame repeats within 25 questions, and by simulating a 20-question topic session to check the topic rule.
- [ ] Mastery levels follow §6 and survive a reload.
- [ ] Works at 360 px wide and in dark mode.
- [ ] The review-mistakes mode serves different kinds from the same frame.

## 10. Known limits of the bank (tell the user if relevant)

- The bank holds 5,407 questions built from **539 hand-written source sentences** (about 12 per topic). Each sentence is tested in up to 10 ways (5 kinds, plus name variants). That's why the frame-spacing rule matters.
- Explanations are deliberately short (one line). The visual lesson carries the teaching.
- A few items test "best answer in context", for example articles and modals of deduction. That's why `~` distractors are kept out of the standalone `judge`/`fix` kinds.
