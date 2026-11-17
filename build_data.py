"""Builds the runtime data for the Bhagavad Gita cross-references visualization.

Reads the raw dataset (gita/gita GitHub repo dump) and produces:
  app/data/gita.js   -> window.GITA = { chapters, sections, verses, meta }
  app/data/links.js  -> window.LINKS = [ [verseA, verseB, score], ... ]

Links are thematic cross-references computed with TF-IDF cosine similarity over
Swami Sivananda's (public domain) English translation, with boilerplate
(speaker tags, vocatives) and high-df tokens pruned. The Gita has no
manuscript equivalent of the Bible's Treasury of Scripture Knowledge, so these
computed links stand in for curated cross-references.

Run: python -I build_data.py
"""

import json
import math
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data-raw"
OUT = ROOT / "app" / "data"

CHAPTERS = [
    ("Arjuna Visada Yoga", "The Despondency of Arjuna", "Visada"),
    ("Sankhya Yoga", "Transcendental Knowledge", "Sankhya"),
    ("Karma Yoga", "The Yoga of Action", "Karma"),
    ("Jnana Karma Sannyasa Yoga", "Knowledge and Action", "Jnana-Karma"),
    ("Karma Sannyasa Yoga", "Renunciation of Action", "Sannyasa"),
    ("Dhyana Yoga", "Meditation", "Dhyana"),
    ("Jnana Vijnana Yoga", "Self-Knowledge and Enlightenment", "Vijnana"),
    ("Akshara Brahma Yoga", "The Imperishable Brahman", "Akshara"),
    ("Raja Vidya Yoga", "The King of Sciences", "Raja-Vidya"),
    ("Vibhuti Vistara Yoga", "Divine Manifestations", "Vibhuti"),
    ("Visvarupa Darsana Yoga", "The Cosmic Form", "Visvarupa"),
    ("Bhakti Yoga", "The Yoga of Devotion", "Bhakti"),
    ("Kshetra Kshetrajna Yoga", "The Field and the Knower", "Kshetra"),
    ("Gunatraya Vibhaga Yoga", "The Three Gunas", "Guna"),
    ("Purushottama Yoga", "The Supreme Person", "Purusha"),
    ("Daivasura Sampad Yoga", "Divine and Demonic Natures", "Daiva"),
    ("Shraddhatraya Vibhaga Yoga", "The Three Kinds of Faith", "Shraddha"),
    ("Moksha Sannyasa Yoga", "Liberation", "Moksha"),
]

SECTIONS = [
    ("despair", "The Despair of Arjuna", [1], "#eb568f"),
    ("action", "The Path of Action", [2, 3, 4, 5, 6], "#cd4805"),
    ("devotion", "The Path of Devotion", [7, 8, 9, 10, 11, 12], "#b48f05"),
    ("reality", "Knowledge of the Real", [13, 14, 15], "#17a7b4"),
    ("natures", "Divine & Demonic", [16, 17], "#119245"),
    ("liberation", "Liberation", [18], "#a06aec"),
]

TRANSLATION_AUTHOR = "Swami Sivananda"  # public domain


STOPWORDS = set(
    """a about above after again against all am an and any are as at be because been
before being below between both but by could did do does doing down during each few
for from further had has have having he her here hers herself him himself his how
i if in into is it its itself just me more most my myself no nor not now of off on
once only or other our ours ourselves out over own same she should so some such
than that the their theirs them themselves then there these they this those through
to too under until up very was we were what when where which while who whom why
will with you your yours yourself yourselves shall may thee thou thy thee thine
whose would can cannot let us also thus even ever never still yet much many one two
three upon among towards toward unless though therefore hence whence wherein
whereof doth hast hath dost art wert
o alas hither thither verily indeed truly certainly without within always
great good best small little own self said says say spake spoke called called's
son sons born people called name named known behold come came comes go goes gone
went going make made makes making take taken takes took give gives given gave
""".split()
)

BOILERPLATE = set(
    """arjuna bharata bharatas dhananjaya kaunteya pandava pandavas kurunandana
mahabaho mahabahu bharatarshabha kurupravira anagha savyasachin gudakesha
krishna krishna's keshava madhusudana hrisikesha govinda vasudeva yadava
sanjaya dhritarashtra dhritarastra kurus kuru kurukshetra dharmakshetra
pritha prithas kunti kuntija panduputra vishwakarma bhagavan bhagawan lord's
blessed supreme personality godhead god's brahman's
""".split()
)

TOKEN_RE = re.compile(r"[a-z']+")
DEV_TOKEN_STRIP = "।॥.,;:!?()[]\"'—-"


def clean_text(text: str) -> str:
    """Strip speaker tags and vocative phrases for the similarity computation."""
    text = re.sub(r"^\s*[A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+)*\s+said\s*[:.?,]*\s*", " ", text)
    text = re.sub(r"\bO\b[^,.:;!?]*[,.:;!?]", " ", text)  # "O Arjuna," / "O son of Pritha,"
    return text


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


def parse_word_meanings(wm: str) -> list[list[str]]:
    """word_meanings is a flat string of `translit—gloss` runs; split it into pairs."""
    words = []
    key = None
    gloss: list[str] = []
    for tok in wm.split():
        if "—" in tok:
            if key:
                words.append([key, " ".join(gloss).strip(" ;:,")])
            key, _, rest = tok.partition("—")
            key = key.strip(".,;:।॥")
            gloss = [rest] if rest else []
        elif key:
            gloss.append(tok)
    if key:
        words.append([key, " ".join(gloss).strip(" ;:,")])
    return [[k, g] for k, g in words if k and re.search(r"[a-zāīūṛṝḷḹēōṃḥśṣṭḍṅñ]", k)]


def devanagari_tokens(text: str) -> list[str]:
    out = []
    for tok in re.split(r"\s+", text):
        tok = tok.strip(DEV_TOKEN_STRIP)
        if tok:
            out.append(tok)
    return out


def find_phrase_echoes(verses: list[dict]):
    """Verses that literally echo each other: maximal shared Devanagari n-grams (3-8 words).

    Speaker-tag refrains are drowned out by a document-frequency cap. One longest echo
    per verse pair is kept.
    """
    tok_lists = [devanagari_tokens(v["sa"]) for v in verses]
    grams: dict[tuple[str, ...], set[int]] = defaultdict(set)
    for i, toks in enumerate(tok_lists):
        for length in range(3, 9):
            for s in range(len(toks) - length + 1):
                grams[tuple(toks[s:s + length])].add(i)

    best: dict[tuple[int, int], tuple[int, str]] = {}  # pair -> (len, phrase)
    for gram, verses_with in grams.items():
        if len(verses_with) < 2 or len(verses_with) > 12:  # df cap kills speaker refrains
            continue
        phrase = " ".join(gram)
        if len(phrase) < 10:  # drop generic 2-3 character fragments ("न च मां")
            continue
        vs = sorted(verses_with)
        for x in range(len(vs)):
            for y in range(x + 1, len(vs)):
                pair = (vs[x], vs[y])
                if pair not in best or len(phrase) > best[pair][0]:
                    best[pair] = (len(phrase), phrase)

    out = [[a, b, phrase, ln] for (a, b), (ln, phrase) in best.items()]
    out.sort(key=lambda x: (-x[3], x[0], x[1]))
    return out


def build_corpus(verses_en: list[str]):
    """Return per-verse token bags with stopwords/boilerplate and high-df tokens pruned."""
    bags = []
    for text in verses_en:
        counts: dict[str, int] = {}
        for tok in tokenize(clean_text(text)):
            if tok in STOPWORDS or tok in BOILERPLATE or len(tok) < 3 or tok.isdigit():
                continue
            counts[tok] = counts.get(tok, 0) + 1
        bags.append(counts)

    n = len(bags)
    df: dict[str, int] = {}
    for counts in bags:
        for tok in counts:
            df[tok] = df.get(tok, 0) + 1
    frequent = {tok for tok, d in df.items() if d / n > 0.22}
    pruned = []
    for counts in bags:
        pruned.append({tok: c for tok, c in counts.items() if tok not in frequent})
    return pruned


def tfidf_vectors(bags):
    n = len(bags)
    df: dict[str, int] = {}
    for counts in bags:
        for tok in counts:
            df[tok] = df.get(tok, 0) + 1
    vectors = []
    for counts in bags:
        vec = {tok: (1.0 + math.log(c)) * math.log(n / df[tok]) for tok, c in counts.items()}
        norm = math.sqrt(sum(w * w for w in vec.values()))
        if norm > 0:
            vec = {tok: w / norm for tok, w in vec.items()}
        vectors.append(vec)
    return vectors


def cosine(a: dict, b: dict) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(w * b.get(tok, 0.0) for tok, w in a.items())


def main() -> int:
    verses_raw = json.loads((RAW / "verse.json").read_text(encoding="utf-8"))
    translations = json.loads((RAW / "translation.json").read_text(encoding="utf-8"))
    chapters_raw = json.loads((RAW / "chapters.json").read_text(encoding="utf-8"))
    commentary_raw = json.loads((RAW / "commentary.json").read_text(encoding="utf-8"))

    verses_raw.sort(key=lambda v: (v["chapter_number"], v["verse_number"]))

    en_by_id = {}
    all_translations: dict[str, dict[int, str]] = {}
    for t in translations:
        all_translations.setdefault(t["authorName"], {})[t["verse_id"]] = t["description"]
        if t["authorName"] == TRANSLATION_AUTHOR:
            en_by_id[t["verse_id"]] = t["description"]

    id2cv = {(v["chapter_number"], v["verse_number"]): v for v in verses_raw}

    verses = []
    for v in verses_raw:
        verses.append(
            {
                "c": v["chapter_number"],
                "v": v["verse_number"],
                "sa": " ".join(v["text"].split()),
                "tr": " ".join(v["transliteration"].split()),
                "en": " ".join(en_by_id[v["id"]].split()),
                "ws": parse_word_meanings(" ".join(v["word_meanings"].split())),
            }
        )

    TRANSLATION_AUTHORS = [
        "Swami Sivananda",
        "Shri Purohit Swami",
        "Swami Gambirananda",
        "Swami Adidevananda",
        "Swami Tejomayananda",
        "Dr. S. Sankaranarayan",
        "Swami Ramsukhdas",
    ]
    translations_out = {
        author: [" ".join(all_translations[author][v["id"]].split()) for v in verses_raw]
        for author in TRANSLATION_AUTHORS
    }

    COMMENTARY_AUTHORS = ["Sri Shankaracharya", "Swami Sivananda"]
    commentaries_out = {
        author: [" ".join(next(
            (c["description"] for c in commentary_raw if c["authorName"] == author and c["verse_id"] == v["id"]),
            "",
        ).split()) for v in verses_raw]
        for author in COMMENTARY_AUTHORS
    }

    phrases = find_phrase_echoes(verses)

    # --- similarity links
    bags = build_corpus([v["en"] for v in verses])
    vectors = tfidf_vectors(bags)
    n = len(vectors)

    pair_scores = []
    for i in range(n):
        for j in range(i + 1, n):
            s = cosine(vectors[i], vectors[j])
            if s > 0.02:
                pair_scores.append((i, j, s))

    ABS = 0.12
    TOPK, TOPK_MIN = 8, 0.09
    best_per_verse: dict[int, list[tuple[float, int, int]]] = {}
    kept = {}
    for i, j, s in pair_scores:
        if s >= ABS:
            kept[(i, j)] = s
        for key in (i, j):
            lst = best_per_verse.setdefault(key, [])
            lst.append((s, i, j))
    for key, lst in best_per_verse.items():
        lst.sort(reverse=True)
        for s, i, j in lst[:TOPK]:
            if s >= TOPK_MIN:
                kept[(min(i, j), max(i, j))] = max(kept.get((min(i, j), max(i, j)), 0.0), s)

    links = sorted(
        ([i, j, round(s * 100) / 100] for (i, j), s in kept.items()), key=lambda x: (-x[2], x[0], x[1])
    )

    chapter_of = [v["c"] for v in verses]
    section_of_chapter = {}
    for ordinal, (_sid, _sname, chs, _color) in enumerate(SECTIONS):
        for ch in chs:
            section_of_chapter[ch] = ordinal
    section_of_verse = [section_of_chapter[c] for c in chapter_of]

    connected = set()
    cross_section = 0
    for i, j, _s in links:
        connected.add(i)
        connected.add(j)
        if section_of_verse[i] != section_of_verse[j]:
            cross_section += 1

    total_pairs = n * (n - 1) // 2
    print(f"verses: {n}")
    print(f"candidate pairs with sim>0.02: {len(pair_scores)} of {total_pairs}")
    print(f"links kept: {len(links)}")
    print(f"verses connected: {len(connected)}/{n} = {len(connected) / n:.1%}")
    print(f"cross-section links: {cross_section}")
    print(f"phrase echoes: {len(phrases)} (longest: {phrases[0][3] if phrases else 0} chars)")
    top = ", ".join(
        f"{verses[i]['c']}.{verses[i]['v']}~{verses[j]['c']}.{verses[j]['v']}({s:.2f})"
        for i, j, s in links[:8]
    )
    print(f"top links: {top}")

    chapter_summaries = {c["chapter_number"]: c.get("chapter_summary", "") for c in chapters_raw}
    chapter_translits = {c["chapter_number"]: c.get("transliteration", "") for c in chapters_raw}

    data = {
        "meta": {
            "title": "Bhagavad Gita Cross-References",
            "translation": TRANSLATION_AUTHOR,
            "verses": n,
            "links": len(links),
            "generated": "from github.com/gita/gita dataset; links computed by TF-IDF cosine similarity",
        },
        "chapters": [
            {
                "n": i + 1,
                "name": CHAPTERS[i][0],
                "gloss": CHAPTERS[i][1],
                "abbr": CHAPTERS[i][2],
                "verses": sum(1 for v in verses if v["c"] == i + 1),
                "transliteration": chapter_translits.get(i + 1, ""),
                "summary": chapter_summaries.get(i + 1, ""),
            }
            for i in range(18)
        ],
        "sections": [
            {"id": sid, "name": sname, "chapters": chs, "color": color}
            for sid, sname, chs, color in SECTIONS
        ],
        "verses": verses,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "gita.js").write_text(
        "window.GITA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    (OUT / "links.js").write_text(
        "window.LINKS = " + json.dumps(links, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    (OUT / "phrases.js").write_text(
        "window.PHRASES = " + json.dumps(phrases, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    (OUT / "translations.js").write_text(
        "window.TRANSLATIONS = " + json.dumps(translations_out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    (OUT / "commentaries.js").write_text(
        "window.COMMENTARIES = " + json.dumps(commentaries_out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT}/[gita,links,phrases,translations,commentaries].js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
