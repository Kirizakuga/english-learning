"""Build the grammar question bank from bank_*.txt into topics.json and questions.json."""
import json, random, re, sys
from pathlib import Path

HERE = Path(__file__).parent
BANDS = {1: "Band 5–6 · Foundation", 2: "Band 6.5–7 · Core", 3: "Band 7.5–8 · Advanced", 4: "Band 8.5–9 · Mastery"}
BAND_OVERRIDE = {
    "futperf": 3, "partic": 3, "wish": 3, "causative": 3, "emph": 3, "ellipsis": 3, "parallel": 3, "advpass": 3,
    "inversion": 4, "cleft": 4, "subj": 4, "nominal": 4, "hedge": 4, "quant": 4,
}
NAMES = ["Mai", "Minh", "Linh", "Tom", "Anna", "Kenji", "Lan", "Sofia", "Duc", "Emma"]
ROLE_NAMES = {"s": "subject", "aux": "helper", "v": "verb", "o": "object / word", "x": "time / extra", "c": "connector"}
NONE_MARK = "∅"


def parse_formula(text):
    rows = []
    for row in text.split("||"):
        chips = []
        for chip in row.split("|"):
            chip = chip.strip()
            if not chip:
                continue
            role, _, label = chip.partition(":")
            chips.append({"role": role.strip(), "text": label.strip()})
        if chips:
            rows.append(chips)
    return rows


def parse_timeline(text):
    out = []
    for part in filter(None, (p.strip() for p in text.split(";"))):
        bits = part.split(":")
        if bits[0] == "pt":
            out.append({"kind": "point", "at": float(bits[1]), "label": ":".join(bits[2:])})
        elif bits[0] == "seg":
            out.append({"kind": "span", "from": float(bits[1]), "to": float(bits[2]), "label": ":".join(bits[3:])})
    return out


def marked(s):
    """[[x]] -> {text, parts:[{t, hl}]} for highlighting."""
    parts, pos = [], 0
    for m in re.finditer(r"\[\[(.*?)\]\]", s):
        if m.start() > pos:
            parts.append({"t": s[pos:m.start()], "hl": False})
        parts.append({"t": m.group(1), "hl": True})
        pos = m.end()
    if pos < len(s):
        parts.append({"t": s[pos:], "hl": False})
    return {"text": re.sub(r"\[\[|\]\]", "", s), "parts": parts}


def parse_bank(path):
    topics, cur = [], None
    for ln, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("@"):
            f = line[1:].split("|")
            tid, band, title, vi, rule = f[:5]
            bad, good, tip, tl = f[-4:]
            cur = {
                "id": tid, "band": BAND_OVERRIDE.get(tid, int(band)), "title": title, "vi": vi, "rule": rule,
                "formula": parse_formula("|".join(f[5:-4])), "wrong": marked(bad), "right": marked(good),
                "tip": tip, "timeline": parse_timeline(tl), "frames": [],
            }
            topics.append(cur)
            continue
        parts = [p.strip() for p in line.split(" | ")]
        if len(parts) != 4:
            sys.exit(f"{path.name}:{ln}: expected 4 fields, got {len(parts)}: {line}")
        sent, ans, dis, expl = parts
        dis = [d.strip() for d in dis.split(";;")]
        soft = {i for i, d in enumerate(dis) if d.startswith("~")}  # wrong only next to the best answer
        dis = [d.lstrip("~") for d in dis]
        if len(dis) != 3:
            sys.exit(f"{path.name}:{ln}: expected 3 distractors: {line}")
        if ans in dis:
            sys.exit(f"{path.name}:{ln}: answer repeated in distractors")
        cur["frames"].append({"s": sent, "a": ans, "d": dis, "soft": soft, "e": expl, "ln": f"{path.name}:{ln}"})
    return topics


def parse_cues(path):
    """cues.txt: 'frame-id | cue' per line; # starts a comment."""
    cues = {}
    for ln, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        fid, sep, cue = (p.strip() for p in line.partition("|"))
        if not sep or not cue:
            sys.exit(f"{path.name}:{ln}: expected 'frame-id | cue': {line}")
        if fid in cues:
            sys.exit(f"{path.name}:{ln}: duplicate cue for {fid}")
        cues[fid] = cue
    return cues


def fill(sentence, x):
    if sentence.strip() == "___":
        return x
    if x.startswith(NONE_MARK):
        if "___ " in sentence:
            out = sentence.replace("___ ", "", 1)
        else:
            out = sentence.replace(" ___", "", 1).replace("___", "", 1)
        return out[:1].upper() + out[1:]
    return sentence.replace("___", x, 1)


def mark_fill(sentence, x):
    """Same as fill but wraps the inserted part in [[ ]] for highlighting."""
    if x.startswith(NONE_MARK):
        return fill(sentence, x)
    return sentence.replace("___", f"[[{x}]]", 1)


def make_items(topic, fi, fr, variant, name, rng):
    items = []
    s = fr["s"].replace("{P}", name) if name else fr["s"]
    whole = s.strip() == "___"
    base = f"{topic['id']}-{fi:02d}" + (f"-{variant}" if name else "")
    right = fill(s, fr["a"])
    wrongs = [fill(s, d) for d in fr["d"]]

    def shuffled(correct, others):
        opts = [correct] + others
        rng.shuffle(opts)
        return opts, opts.index(correct)

    # 1. choose: pick the word/phrase for the gap
    opts, ai = shuffled(fr["a"], list(fr["d"]))
    items.append({"kind": "choose", "prompt": "Choose the correct sentence." if whole else s, "options": opts, "answer": ai})

    if not whole:
        # 2. correct: which full sentence is correct?
        opts, ai = shuffled(right, wrongs)
        items.append({"kind": "correct", "prompt": "Which sentence is correct?", "options": opts, "answer": ai})

    # 3. judge: correct or incorrect? (1 right + 3 wrong)
    items.append({"kind": "judge", "prompt": right, "options": ["Correct", "Incorrect"], "answer": 0, "fixed": right})
    for k, w in enumerate(wrongs):
        if k in fr["soft"]:
            continue
        items.append({"kind": "judge", "prompt": w, "options": ["Correct", "Incorrect"], "answer": 1, "fixed": right, "_k": k})

    if not whole:
        # 4. fix: the highlighted part is wrong, choose the replacement
        for k, d in enumerate(fr["d"]):
            if d.startswith(NONE_MARK) or k in fr["soft"]:
                continue  # nothing to highlight
            others = [x for j, x in enumerate(fr["d"]) if j != k]
            opts, ai = shuffled(fr["a"], others + ["No change needed"])
            items.append({"kind": "fix", "prompt": mark_fill(s, d), "options": opts, "answer": ai, "_k": k})
        # 5. type: type the missing word(s)
        if NONE_MARK not in fr["a"] and len(fr["a"]) <= 26 and topic["id"] != "punct":
            items.append({"kind": "type", "prompt": s, "options": [], "answer": fr["a"]})

    for n, it in enumerate(items):
        k = it.pop("_k", None)
        it["id"] = f"{base}-{it['kind']}" + (f"{k}" if k is not None else "")
        it["topic"] = topic["id"]
        it["frame"] = f"{topic['id']}-{fi:02d}"
        it["explain"] = fr["e"]
        if it["kind"] == "judge":
            it["explain"] = ("Correct. " if it["answer"] == 0 else f"Incorrect. Correct version: {it['fixed']} ") + fr["e"]
    return items


def main():
    rng = random.Random(2026)
    cues = parse_cues(HERE / "cues.txt")
    topics = []
    for name in ("bank_a.txt", "bank_b.txt", "bank_c.txt"):
        topics += parse_bank(HERE / name)
    topics.sort(key=lambda t: t["band"])  # stable: keeps file order within a band

    questions, seen = [], set()
    for t in topics:
        for fi, fr in enumerate(t["frames"], 1):
            if "{P}" in fr["s"]:
                names = rng.sample(NAMES, 2)
                variants = [(1, names[0]), (2, names[1])]
            else:
                variants = [(1, None)]
            for v, nm in variants:
                for it in make_items(t, fi, fr, v, nm, rng):
                    assert it["id"] not in seen, it["id"]
                    seen.add(it["id"])
                    assert "___" not in json.dumps(it["options"]), it
                    assert "{P}" not in it["prompt"], it
                    if it["options"]:
                        assert len(set(it["options"])) == len(it["options"]), (fr["ln"], it)
                    if it["kind"] == "type":
                        if it["frame"] not in cues:
                            sys.exit(f"cues.txt: no cue for typed frame {it['frame']} ({fr['ln']})")
                        it["cue"] = cues[it["frame"]]
                    questions.append(it)

    typed = {q["frame"] for q in questions if q["kind"] == "type"}
    unused = sorted(set(cues) - typed)
    if unused:
        sys.exit(f"cues.txt: cues for frames without a typed question: {', '.join(unused)}")

    out_topics = []
    for t in topics:
        q = [x for x in questions if x["topic"] == t["id"]]
        out_topics.append({
            "id": t["id"], "band": t["band"], "bandLabel": BANDS[t["band"]], "title": t["title"], "vi": t["vi"],
            "rule": t["rule"], "formula": t["formula"], "wrong": t["wrong"], "right": t["right"], "tip": t["tip"],
            "timeline": t["timeline"], "frameCount": len(t["frames"]), "questionCount": len(q),
        })

    (HERE.parent / "data").mkdir(exist_ok=True)
    with open(HERE.parent / "data" / "questions.json", "w", encoding="utf-8") as fh:
        fh.write("[\n" + ",\n".join(json.dumps(q, ensure_ascii=False) for q in questions) + "\n]\n")
    with open(HERE.parent / "data" / "topics.json", "w", encoding="utf-8") as fh:
        fh.write("[\n" + ",\n".join(json.dumps(t, ensure_ascii=False) for t in out_topics) + "\n]\n")
    meta = {"roles": ROLE_NAMES, "bands": BANDS, "topicCount": len(out_topics), "frameCount": sum(t["frameCount"] for t in out_topics), "questionCount": len(questions)}
    (HERE.parent / "data" / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    from collections import Counter
    print(json.dumps(meta, ensure_ascii=False))
    print(Counter(q["kind"] for q in questions))
    print(Counter(t["band"] for t in out_topics))
    for t in out_topics:
        print(f"{t['band']} {t['id']:<10} frames={t['frameCount']:>2} q={t['questionCount']}")


if __name__ == "__main__":
    main()
