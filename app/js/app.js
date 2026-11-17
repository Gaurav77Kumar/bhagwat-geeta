(function () {
  "use strict";

  const GITA = window.GITA;
  const RAW_LINKS = window.LINKS; 
  const PHRASES = window.PHRASES || []; 
  const TRANSLATIONS = window.TRANSLATIONS || {};
  const COMMENTARIES = window.COMMENTARIES || {};

  const $ = (id) => document.getElementById(id);

  function track(event, props) {
    try {
      const payload = { name: event };
      if (props) payload.data = props;
      if (typeof window.va === "function") {
        window.va("event", payload);
      } else {
        (window.vaq = window.vaq || []).push(["event", payload]);
      }
    } catch {
    }
  }
  const store = {
    get(k, d) {
      try {
        return localStorage.getItem("gita." + k) ?? d;
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem("gita." + k, v);
      } catch {
        
      }
    },
  };


  const verses = GITA.verses;
  const total = verses.length;
  const chapterOf = verses.map((v) => v.c - 1);

  const chapterStart = [];
  const chapterEnd = [];
  for (let i = 0; i < GITA.chapters.length; i++) chapterStart.push(-1);
  for (let i = 0; i < total; i++) {
    const c = chapterOf[i];
    if (chapterStart[c] === -1) chapterStart[c] = i;
    chapterEnd[c] = i + 1;
  }

  const sectionOfChapter = [];
  GITA.sections.forEach((s, i) => {
    for (const ch of s.chapters) sectionOfChapter[ch - 1] = i;
  });
  const sectionOfVerse = chapterOf.map((c) => sectionOfChapter[c]);
  const sectionColors = GITA.sections.map((s) => s.color);

  const model = {
    chapters: GITA.chapters,
    sections: GITA.sections,
    verses,
    total,
    chapterOf,
    chapterStart,
    chapterEnd,
    sectionOfChapter,
    sectionOfVerse,
    sectionColors,
  };


  const state = {
    focus: null,
    sectionsOn: GITA.sections.map(() => true),
    minScore: 0.09, 
    shown: [], 
    incident: [], 
    translation: TRANSLATIONS[store.get("translation", "Swami Sivananda")]
      ? store.get("translation", "Swami Sivananda")
      : Object.keys(TRANSLATIONS)[0] || "Swami Sivananda",
    commAuthor: store.get("commentary", "Sri Shankaracharya"),
    panelWord: null, 
    audio: null, 
    lens: null, 
    journey: null, 
  };

  function T(i) {
    const list = TRANSLATIONS[state.translation];
    return (list && list[i]) || verses[i].en;
  }

  const viz = new window.ArcViz($("viz"), model);

  let threads = null; 
  let currentView = "arcs";

  const normWord = (w) => w.toLowerCase().replace(/[.,;:!?।॥'"’‘()\[\]—-]/g, "").trim();
  const wordIndex = new Map();
  for (let i = 0; i < total; i++) {
    for (const [w, gloss] of verses[i].ws || []) {
      const key = normWord(w);
      if (!key) continue;
      let entry = wordIndex.get(key);
      if (!entry) {
        entry = { display: w, occurrences: [] };
        wordIndex.set(key, entry);
      }
      if (gloss) entry.occurrences.push({ i, gloss });
      else entry.occurrences.push({ i, gloss: "" });
    }
  }

  function applyFilters() {
    state.shown = RAW_LINKS.filter(
      ([a, b, s]) => s >= state.minScore && state.sectionsOn[sectionOfVerse[a]] && state.sectionsOn[sectionOfVerse[b]],
    );
    const incident = new Array(total);
    for (const [a, b, s] of state.shown) {
      (incident[a] || (incident[a] = [])).push({ other: b, s });
      (incident[b] || (incident[b] = [])).push({ other: a, s });
    }
    state.incident = incident;
    viz.setLinks(state.shown);
    viz.setPhrases(PHRASES);
    updateStats();
    if (threads) threads.refresh();
    if (state.focus != null) renderPanel(state.focus);
  }

  function updateStats() {
    const shown = state.shown.length;
    const connected = new Set();
    let cross = 0;
    for (const [a, b] of state.shown) {
      connected.add(a);
      connected.add(b);
      if (sectionOfVerse[a] !== sectionOfVerse[b]) cross++;
    }
    const pct = Math.round((connected.size / total) * 1000) / 10;
    $("stats-main").innerHTML = `<b>${total}</b> verses · <b>${fmt(shown)}</b> of ${fmt(RAW_LINKS.length)} links shown`;
    $("stats-sub").innerHTML = `<b>${pct}%</b> of verses connected · <b>${fmt(cross)}</b> links between the sections`;
  }

  const fmt = (n) => n.toLocaleString("en-US");


  function buildLegend() {
    const el = $("legend");
    el.innerHTML = "";
    GITA.sections.forEach((s, i) => {
      const row = document.createElement("button");
      row.className = "legend-row";
      row.innerHTML = `<span class="dash" style="--c:${s.color}"></span>${s.name}`;
      row.addEventListener("click", () => toggleSection(i));
      el.appendChild(row);
    });
  }

  function toggleSection(i) {
    state.sectionsOn[i] = !state.sectionsOn[i];
    syncLegend();
    syncFilters();
    applyFilters();
  }

  function syncLegend() {
    document.querySelectorAll("#legend .legend-row").forEach((row, i) => {
      row.classList.toggle("is-off", !state.sectionsOn[i]);
    });
  }


  function buildFilters() {
    const pop = $("filters-pop");
    let html = `<div class="filters-title">Sections</div>`;
    GITA.sections.forEach((s, i) => {
      html += `<label class="filter-row" data-sec="${i}">
        <input type="checkbox" ${state.sectionsOn[i] ? "checked" : ""} data-sec="${i}">
        <span class="dash" style="--c:${s.color}"></span>${s.name}
      </label>`;
    });
    html += `<div class="filters-title" style="margin-top:14px">Minimum match
        <span id="min-label">${Math.round(state.minScore * 100)}%</span></div>
      <input type="range" id="min-score" min="9" max="60" step="1" value="${Math.round(state.minScore * 100)}">
      <div class="filters-note">Links are computed by text similarity — raise the bar for stronger matches.</div>`;
    pop.innerHTML = html;

    pop.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        state.sectionsOn[Number(cb.dataset.sec)] = cb.checked;
        syncLegend();
        applyFilters();
      });
    });
    $("min-score").addEventListener("input", (e) => {
      state.minScore = Number(e.target.value) / 100;
      $("min-label").textContent = `${e.target.value}%`;
      applyFilters();
    });
  }

  function syncFilters() {
    document.querySelectorAll("#filters-pop input[type=checkbox]").forEach((cb) => {
      cb.checked = state.sectionsOn[Number(cb.dataset.sec)];
      cb.closest(".filter-row").classList.toggle("is-off", !cb.checked);
    });
  }

  $("filters-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = $("filters-pop");
    const open = pop.hidden;
    pop.hidden = !open;
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", (e) => {
    const pop = $("filters-pop");
    if (!pop.hidden && !pop.contains(e.target)) {
      pop.hidden = true;
      $("filters-btn").setAttribute("aria-expanded", "false");
    }
  });

  const LENS_TERMS = [
    { stem: "dharm", label: "dharma" },
    { stem: "karm", label: "karma" },
    { stem: "yog", label: "yoga" },
    { stem: "ātm", label: "ātman" },
    { stem: "bhakt", label: "bhakti" },
    { stem: "jñān", label: "jñāna" },
    { stem: "mokṣ", label: "mokṣa" },
    { stem: "guṇ", label: "guṇa" },
    { stem: "man", label: "manas" },
    { stem: "śraddh", label: "śraddhā" },
    { stem: "yajñ", label: "yajña" },
    { stem: "brahm", label: "brahman" },
  ].map((t) => {
    const versesSet = new Set();
    for (const [key, entry] of wordIndex) {
      if (key.startsWith(t.stem)) for (const o of entry.occurrences) versesSet.add(o.i);
    }
    return { ...t, verses: versesSet };
  });

  function buildLensBar() {
    const chips = $("lens-chips");
    chips.innerHTML = "";
    for (const term of LENS_TERMS) {
      if (term.verses.size < 4) continue; // too rare to be a lens
      const chip = document.createElement("button");
      chip.className = "lens-chip";
      chip.dataset.label = term.label;
      chip.innerHTML = `${term.label} <span class="lens-count">${term.verses.size}</span>`;
      chip.title = `Highlight the ${term.verses.size} verses containing this word family`;
      chip.addEventListener("click", () => {
        if (state.lens && state.lens.label === term.label) clearLens();
        else setLens(term);
        $("lens-pop").hidden = true;
        $("lens-btn").setAttribute("aria-expanded", "false");
      });
      chips.appendChild(chip);
    }
  }

  function setLens(term) {
    setLensFromSet(term.label, term.verses, term);
    $("lens-pop").hidden = true;
    $("lens-btn").setAttribute("aria-expanded", "false");
  }

  /** General lens: highlight any set of verses, chained in reading order. */
  function setLensFromSet(label, verseSet, presetTerm) {
    const sorted = [...verseSet].sort((a, b) => a - b);
    const chain = [];
    for (let i = 0; i < sorted.length - 1; i++) chain.push([sorted[i], sorted[i + 1]]);
    state.lens = { stem: presetTerm ? presetTerm.stem : null, label, verses: verseSet, chain };
    viz.setLens(chain, verseSet);
    document.querySelectorAll(".lens-chip").forEach((chip) => {
      chip.classList.toggle("is-active", !!presetTerm && chip.dataset.label === presetTerm.label);
    });
    syncLensButton();
    syncUrl();
    track("lens", { query: label.slice(0, 40), verses: String(verseSet.size) });
  }

  /** Verses whose current-translation text (or transliteration) contains the query. */
  function matchesForQuery(q) {
    const needle = q.toLowerCase();
    const set = new Set();
    if (needle.length < 2) return set;
    for (let i = 0; i < total; i++) {
      if (T(i).toLowerCase().includes(needle) || verses[i].tr.toLowerCase().includes(needle)) set.add(i);
    }
    return set;
  }

  function clearLens() {
    state.lens = null;
    viz.setLens(null, null);
    document.querySelectorAll(".lens-chip").forEach((chip) => chip.classList.remove("is-active"));
    syncLensButton();
    syncUrl();
  }

  function syncLensButton() {
    const active = state.lens != null;
    $("lens-btn").classList.toggle("is-active", active);
    $("lens-btn-label").textContent = active ? state.lens.label : "Lens";
    $("lens-clear").hidden = !active;
  }

  function startJourney(id, step = 0) {
    const journey = window.JOURNEYS.find((j) => j.id === id);
    if (!journey) return;
    if (currentView !== "arcs") switchView("arcs");
    state.journey = { id, step: Math.min(Math.max(step, 0), journey.steps.length - 1) };
    $("journeys-pop").hidden = true;
    $("journeys-btn").setAttribute("aria-expanded", "false");
    track("journey_start", { journey: id });
    if (state.journey.step === journey.steps.length - 1) track("journey_complete", { journey: id });
    goToStep(state.journey.step);
  }

  function journeyStep(delta) {
    if (!state.journey) return;
    const journey = window.JOURNEYS.find((j) => j.id === state.journey.id);
    const next = Math.min(Math.max(state.journey.step + delta, 0), journey.steps.length - 1);
    state.journey.step = next;
    goToStep(next);
  }

  function goToStep(step) {
    if (!state.journey) return;
    const journey = window.JOURNEYS.find((j) => j.id === state.journey.id);
    const st = journey.steps[step];
    const idx = parseRef(st.ref);
    if (idx == null) return;
    quietFocus(idx);
    const visible = idx >= viz.view.start && idx < viz.view.end && viz.view.end - viz.view.start < total;
    if (!visible) viz.animateViewTo(viz.chapterView(chapterOf[idx]));
    renderJourneyCard();
    syncUrl();
    if (state.journey.step === journey.steps.length - 1) track("journey_complete", { journey: state.journey.id });
  }

  /** Highlight a verse without opening the panel — the journey card is the narrative. */
  function quietFocus(idx) {
    state.focus = idx;
    state.panelWord = null;
    stopAudio();
    viz.setFocus(idx);
    $("panel").hidden = true;
  }

  function renderJourneyCard() {
    if (!state.journey) return;
    const journey = window.JOURNEYS.find((j) => j.id === state.journey.id);
    const st = journey.steps[state.journey.step];
    const idx = parseRef(st.ref);
    $("journey-name").textContent = journey.title;
    $("journey-step-label").textContent = `Step ${state.journey.step + 1} of ${journey.steps.length}`;
    $("journey-caption").textContent = st.caption;
    const refBtn = $("journey-ref");
    const v = verses[idx];
    refBtn.textContent = `${v.c}.${v.v} · ${GITA.chapters[chapterOf[idx]].name}`;
    refBtn.onclick = () => openPanel(idx);
    const dots = $("journey-dots");
    dots.innerHTML = "";
    journey.steps.forEach((_s, i) => {
      const dot = document.createElement("button");
      dot.className = "journey-dot" + (i === state.journey.step ? " is-active" : "");
      dot.title = `Step ${i + 1}`;
      dot.addEventListener("click", () => {
        state.journey.step = i;
        goToStep(i);
      });
      dots.appendChild(dot);
    });
    $("journey-prev").disabled = state.journey.step === 0;
    $("journey-next").disabled = state.journey.step === journey.steps.length - 1;
    $("journey-progress-fill").style.width = ((state.journey.step + 1) / journey.steps.length) * 100 + "%";
    $("journey-card").hidden = false;
  }

  function exitJourney() {
    if (!state.journey) return;
    state.journey = null;
    $("journey-card").hidden = true;
    closePanel(); // hand the reader a clean, un-dimmed canvas after the tour
    syncUrl();
  }

  function buildJourneysPop() {
    const pop = $("journeys-pop");
    pop.innerHTML = `<div class="filters-title">Guided journeys</div>`;
    for (const j of window.JOURNEYS) {
      const row = document.createElement("button");
      row.className = "journey-row";
      row.innerHTML = `<b>${escapeHtml(j.title)}</b>
        <span class="journey-blurb">${escapeHtml(j.blurb)}</span>
        <span class="journey-meta">${j.steps.length} verses</span>`;
      row.addEventListener("click", () => startJourney(j.id));
      pop.appendChild(row);
    }
  }

  $("journeys-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = $("journeys-pop");
    const open = pop.hidden;
    pop.hidden = !open;
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });

  $("journey-prev").addEventListener("click", () => journeyStep(-1));
  $("journey-next").addEventListener("click", () => journeyStep(1));
  $("journey-close").addEventListener("click", exitJourney);

  $("lens-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = $("lens-pop");
    const open = pop.hidden;
    pop.hidden = !open;
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });

  $("lens-clear").addEventListener("click", clearLens);

  $("lens-search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim();
    const set = matchesForQuery(q);
    if (set.size < 2) return;
    setLensFromSet(q, set);
    e.target.value = "";
    $("lens-pop").hidden = true;
    $("lens-btn").setAttribute("aria-expanded", "false");
  });

  document.addEventListener("click", (e) => {
    const wrap = document.querySelector(".lens-wrap");
    const pop = $("lens-pop");
    if (!pop.hidden && !wrap.contains(e.target)) {
      pop.hidden = true;
      $("lens-btn").setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("click", (e) => {
    const wrap = document.querySelector(".journeys-wrap");
    const pop = $("journeys-pop");
    if (!pop.hidden && !wrap.contains(e.target)) {
      pop.hidden = true;
      $("journeys-btn").setAttribute("aria-expanded", "false");
    }
  });


  const TRANSLATION_LABELS = {
    "Swami Sivananda": "Sivananda",
    "Shri Purohit Swami": "Purohit Swami",
    "Swami Gambirananda": "Gambirananda",
    "Swami Adidevananda": "Adidevananda",
    "Swami Tejomayananda": "Tejomayananda",
    "Dr. S. Sankaranarayan": "Sankaranarayan",
    "Swami Ramsukhdas": "Ramsukhdas · हिंदी",
  };

  function buildTranslationSelect() {
    const sel = $("translation-select");
    sel.innerHTML = "";
    for (const author of Object.keys(TRANSLATIONS)) {
      const opt = document.createElement("option");
      opt.value = author;
      opt.textContent = TRANSLATION_LABELS[author] || author;
      opt.selected = author === state.translation;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      state.translation = sel.value;
      store.set("translation", sel.value);
      track("translation", { author: sel.value });
      if (threads) threads.refresh();
      if (state.focus != null) renderPanel(state.focus);
    });
  }

  const tooltip = $("tooltip");
  viz.onHover = (verse, x, y) => {
    if (verse == null) {
      tooltip.hidden = true;
      return;
    }
    const v = verses[verse];
    const text = T(verse);
    const trimmed = text.length > 110 ? text.slice(0, 110).replace(/\s+\S*$/, "") + "…" : text;
    tooltip.innerHTML = `<span class="ref">${v.c}.${v.v}</span>${escapeHtml(trimmed)}`;
    tooltip.hidden = false;
    const stage = $("stage").getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    tooltip.style.left = Math.min(x + 14, stage.width - tw - 8) + "px";
    tooltip.style.top = Math.min(y + 16, stage.height - th - 8) + "px";
  };

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function openPanel(index) {
    state.focus = index;
    state.panelWord = null;
    viz.setFocus(index);
    $("panel").hidden = false;
    renderPanel(index);
    if (currentView === "threads" && threads) threads.showVerse(index);
    // During a journey, opening the verse panel is a peek: keep the tour alive
    // but tuck the card away until the panel closes.
    if (state.journey) $("journey-card").hidden = true;
    track("verse_focus", { ref: verses[index].c + "." + verses[index].v, chapter: String(verses[index].c) });
    syncUrl();
  }

  function closePanel() {
    state.focus = null;
    state.panelWord = null;
    stopAudio();
    viz.setFocus(null);
    $("panel").hidden = true;
    if (threads && currentView === "threads") threads.syncSelection();
    if (state.journey) {
      // Peek finished — restore the tour's verse highlight and bring the card back.
      const j = window.JOURNEYS.find((x) => x.id === state.journey.id);
      const idx = parseRef(j.steps[state.journey.step].ref);
      if (idx != null) quietFocus(idx);
      renderJourneyCard();
    }
    syncUrl();
  }

  function syncUrl() {
    try {
      const p = new URLSearchParams();
      if (state.focus != null) {
        const v = verses[state.focus];
        p.set("ref", `${v.c}.${v.v}`);
      }
      if (state.lens) p.set("word", state.lens.label);
      if (state.journey) {
        p.set("journey", state.journey.id);
        p.set("step", String(state.journey.step + 1));
      }
      const qs = p.toString();
      history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
    } catch {
    }
  }

  function formatSanskrit(sa) {
    return sa
      .replace(/[।॥]{0,2}\s*\d+\.\d+\s*[।॥]{0,2}\s*$/, "")
      .replace(/([।॥])\s*/g, "$1\n")
      .replace(/[।॥]+$/, "")
      .trim();
  }

  function renderPanel(index) {
    const v = verses[index];
    const sec = GITA.sections[sectionOfVerse[index]];
    const wordView = $("word-view");
    if (wordView) wordView.remove();
    $("panel-dash").style.setProperty("--c", sec.color);
    $("panel-meta-text").textContent = `${sec.name} · Chapter ${v.c}`;
    $("panel-ref").textContent = `${v.c}.${v.v}`;
    $("panel-sa").textContent = formatSanskrit(v.sa);
    $("panel-tr").textContent = v.tr;
    $("panel-en").textContent = T(index);

    if (state.panelWord) {
      showVerseSections(false);
      renderWordPanel(state.panelWord);
      return;
    }
    showVerseSections(true);

    const conns = (state.incident[index] || []).slice().sort((a, b) => b.s - a.s);

    const counts = new Array(GITA.sections.length).fill(0);
    for (const c of conns) counts[sectionOfVerse[c.other]]++;
    const strip = $("connects-strip");
    strip.innerHTML = "";
    counts.forEach((n, i) => {
      if (!n) return;
      const seg = document.createElement("span");
      seg.style.width = (n / conns.length) * 100 + "%";
      seg.style.background = sectionColors[i];
      seg.title = `${GITA.sections[i].name}: ${n}`;
      strip.appendChild(seg);
    });
    $("connects-count").textContent = conns.length;

    $("conn-shown").textContent = `${conns.length} shown`;
    const list = $("conn-list");
    list.innerHTML = "";
    if (!conns.length) {
      list.innerHTML = `<div class="conn-empty">No connections pass the current filters.</div>`;
    } else {
      const byChapter = new Map();
      for (const c of conns) {
        const ch = chapterOf[c.other];
        (byChapter.get(ch) || byChapter.set(ch, []).get(ch)).push(c);
      }
      for (const ch of [...byChapter.keys()].sort((a, b) => a - b)) {
        const group = document.createElement("div");
        group.className = "conn-group";
        const head = document.createElement("div");
        head.className = "conn-group-head";
        const chapVerse = GITA.chapters[ch];
        head.innerHTML = `<span class="dash" style="--c:${sectionColors[sectionOfChapter[ch]]}"></span>
          Chapter ${chapVerse.n} <span style="color:var(--text-muted)">· ${escapeHtml(chapVerse.name)}</span>`;
        group.appendChild(head);
        for (const c of byChapter.get(ch)) {
          const other = verses[c.other];
          const btn = document.createElement("button");
          btn.className = "conn-item";
          const pct = Math.round(c.s * 100);
          btn.innerHTML = `<span class="row1"><span class="ref">${other.c}.${other.v}</span>
              <span class="match">${pct}% match</span></span>
            <span class="quote">${escapeHtml(T(c.other))}</span>`;
          btn.addEventListener("click", () => {
            openPanel(c.other);
            // Keep the current zoom if the verse is already visible; otherwise jump to its chapter.
            const visible =
              c.other >= viz.view.start && c.other < viz.view.end && viz.view.end - viz.view.start < total;
            if (!visible) viz.animateViewTo(viz.chapterView(chapterOf[c.other]));
          });
          group.appendChild(btn);
        }
        list.appendChild(group);
      }
    }

    renderEchoes(index);
    renderWords(index);
    renderCommentary(index);
  }

  function showVerseSections(show) {
    for (const id of ["echoes-sec", "words-sec", "commentary-sec"]) {
      $(id).hidden = !show;
    }
    $("panel-connects").hidden = !show;
    $("conn-body").style.display = show ? "" : "none";
    $("panel-sa").style.display = show ? "" : "none";
    $("panel-tr").style.display = show ? "" : "none";
    $("panel-en").style.display = show ? "" : "none";
    $("panel-context").style.display = show ? "" : "none";
    $("panel-audio").hidden = !show;
    $("panel-share").hidden = !show;
  }


  function renderEchoes(index) {
    const mine = PHRASES.filter(([a, b]) => a === index || b === index);
    $("echoes-sec").hidden = mine.length === 0;
    if (!mine.length) return;
    $("echoes-count").textContent = `${mine.length} shared phrase${mine.length > 1 ? "s" : ""}`;
    const body = $("echoes-body");
    body.innerHTML = "";
    for (const [a, b, phrase] of mine) {
      const other = a === index ? b : a;
      const vOther = verses[other];
      const item = document.createElement("button");
      item.className = "echo-item";
      item.innerHTML = `<span class="echo-phrase" lang="sa">“${escapeHtml(phrase)}”</span>
        <span class="row1"><span class="ref">${vOther.c}.${vOther.v}</span>
        <span class="match">in Chapter ${vOther.c}</span></span>`;
      item.addEventListener("click", () => openPanel(other));
      body.appendChild(item);
    }
  }

  function renderWords(index) {
    const words = verses[index].ws || [];
    $("words-count").textContent = `${words.length} words`;
    const body = $("words-body");
    body.innerHTML = "";
    for (const [w, gloss] of words) {
      const chip = document.createElement("button");
      chip.className = "word-chip";
      chip.innerHTML = `<span class="word">${escapeHtml(w)}</span><span class="gloss">${escapeHtml(gloss)}</span>`;
      const key = normWord(w);
      const entry = wordIndex.get(key);
      if (entry) {
        chip.title = `See all ${entry.occurrences.length} occurrences`;
        chip.addEventListener("click", () => {
          state.panelWord = key;
          renderPanel(index);
        });
      } else {
        chip.disabled = true;
      }
      body.appendChild(chip);
    }
  }

  function renderWordPanel(key) {
    const entry = wordIndex.get(key);
    if (!entry) return;
    const occ = entry.occurrences;
    const head = document.createElement("div");
    head.className = "word-head";
    head.innerHTML = `
      <button class="word-back" id="word-back">
        <svg viewBox="0 0 16 16" width="11" height="11"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Back to verse
      </button>
      <div class="word-big" lang="sa">${escapeHtml(entry.display)}</div>
      <div class="word-sub">${occ.length} occurrence${occ.length > 1 ? "s" : ""}</div>`;
    const list = document.createElement("div");
    list.className = "word-occ-list";
    const byVerse = new Map();
    for (const o of occ) {
      (byVerse.get(o.i) || byVerse.set(o.i, []).get(o.i)).push(o.gloss);
    }
    for (const i of [...byVerse.keys()].sort((a, b) => a - b)) {
      const v = verses[i];
      const btn = document.createElement("button");
      btn.className = "conn-item";
      btn.innerHTML = `<span class="row1"><span class="ref">${v.c}.${v.v}</span>
          <span class="match">${escapeHtml(byVerse.get(i).filter(Boolean).join("; ")) || escapeHtml(T(i).slice(0, 60))}</span></span>
        <span class="quote">${escapeHtml(T(i))}</span>`;
      btn.addEventListener("click", () => {
        state.panelWord = null;
        openPanel(i);
      });
      list.appendChild(btn);
    }
    const holder = document.createElement("div");
    holder.id = "word-view";
    holder.appendChild(head);
    holder.appendChild(list);
    $("panel-ref").after(holder);
    $("word-back").addEventListener("click", () => {
      state.panelWord = null;
      if (state.focus != null) renderPanel(state.focus);
    });
  }

  function renderCommentary(index) {
    const authors = Object.keys(COMMENTARIES);
    $("commentary-sec").hidden = authors.length === 0;
    if (!authors.length) return;
    if (!COMMENTARIES[state.commAuthor]) state.commAuthor = authors[0];
    $("commentary-author").textContent = ""; // the author tabs below say it
    const tabs = $("comm-tabs");
    tabs.innerHTML = "";
    for (const author of authors) {
      const tab = document.createElement("button");
      tab.className = "comm-tab" + (author === state.commAuthor ? " is-active" : "");
      tab.textContent = author.replace(/^Sri |^Swami /, "");
      tab.addEventListener("click", () => {
        state.commAuthor = author;
        store.set("commentary", author);
        renderCommentary(index);
      });
      tabs.appendChild(tab);
    }
    const raw = (COMMENTARIES[state.commAuthor] || [])[index] || "";
    let text = raw;
    const cut = text.search(/Commentary\b/);
    if (cut >= 0) text = text.slice(cut + "Commentary".length);
    text = text
      .replace(/\s*\?\s*/g, " · ")
      .replace(/\.(?=[A-Za-z])/g, ". ")
      .trim();
    $("comm-text").textContent = text || "No commentary for this verse in this selection.";
  }

  function stopAudio() {
    if (state.audio) {
      state.audio.pause();
      state.audio.src = "";
      state.audio = null;
    }
    $("panel-audio").classList.remove("is-playing");
  }

  $("panel-audio").addEventListener("click", () => {
    if (state.audio) {
      stopAudio();
      return;
    }
    if (state.focus == null) return;
    const v = verses[state.focus];
    const audio = new Audio(
      `https://raw.githubusercontent.com/gita/gita/main/data/verse_recitation/${v.c}/${v.v}.mp3`,
    );
    state.audio = audio;
    $("panel-audio").classList.add("is-playing");
    track("audio_play", { ref: v.c + "." + v.v });
    audio.addEventListener("ended", stopAudio);
    audio.addEventListener("error", stopAudio);
    audio.play().catch(() => stopAudio());
  });

  const SHARE_W = 1080;
  const SHARE_H = 1350;

  function drawShareCard(canvas, index) {
    const v = verses[index];
    const sec = GITA.sections[sectionOfVerse[index]];
    const ctx = canvas.getContext("2d");
    canvas.width = SHARE_W;
    canvas.height = SHARE_H;
    const W = SHARE_W;
    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, 0, W, SHARE_H);
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = sec.color;
    ctx.fillRect(80, 118, 44, 10);
    ctx.fillStyle = "#9a9890";
    ctx.font = '30px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(`${sec.name} · Chapter ${v.c}`, 142, 132);

    ctx.fillStyle = "#ecebe6";
    ctx.font = '600 110px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    ctx.fillText(`${v.c}.${v.v}`, 80, 268);

    ctx.font = '44px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    let y = wrapText(ctx, formatSanskrit(v.sa), 80, 350, W - 160, 68);
    y += 26;

    ctx.fillStyle = "#b9b7b0";
    ctx.font = 'italic 34px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    const translitLines = wrapLines(ctx, v.tr, W - 160, 3);
    for (const line of translitLines) {
      ctx.fillText(line, 80, y);
      y += 46;
    }
    y += 14;
    ctx.fillStyle = "#ecebe6";
    ctx.font = '38px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    const enLines = wrapLines(ctx, T(index), W - 160, 7);
    for (const line of enLines) {
      ctx.fillText(line, 80, y);
      y += 54;
    }
    const axisY = SHARE_H - 130;
    const axisX = 80;
    const axisW = W - 160;
    const totalLinks = (state.incident[index] || []).slice(0, 24);
    const maxH = 190;
    for (const { other } of totalLinks) {
      const xa = axisX + (index / total) * axisW;
      const xb = axisX + (other / total) * axisW;
      const rx = Math.abs(xb - xa) / 2;
      if (rx < 1) continue;
      const ry = Math.min(rx, maxH);
      const ca = sectionColors[sectionOfVerse[index]];
      const cb = sectionColors[sectionOfVerse[other]];
      const grad = ctx.createLinearGradient(xa, axisY, xb, axisY);
      grad.addColorStop(0, ca);
      grad.addColorStop(1, cb);
      ctx.strokeStyle = ca === cb ? ca : grad;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse((xa + xb) / 2, axisY, rx, ry, 0, Math.PI, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Chapter bars.
    let bx = axisX;
    for (let c = 0; c < GITA.chapters.length; c++) {
      const w = (axisW * GITA.chapters[c].verses) / total;
      ctx.globalAlpha = c % 2 === 0 ? 1 : 0.72;
      ctx.fillStyle = sectionColors[sectionOfChapter[c]];
      ctx.fillRect(bx + 1, axisY, Math.max(w - 2, 1), 12);
      bx += w;
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ecebe6";
    ctx.fillRect(axisX + (index / total) * axisW - 2, axisY - 3, 5, 18);

    // Footer.
    ctx.fillStyle = "#9a9890";
    ctx.font = '24px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Bhagavad Gita Cross-References", W / 2, SHARE_H - 56);
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    for (const line of wrapLines(ctx, text, maxWidth)) {
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
    return y;
  }

  function wrapLines(ctx, text, maxWidth, maxLines = 12) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
        if (lines.length >= maxLines) {
          lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+\S*$/, "") + "…";
          return lines;
        }
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function openShareModal() {
    if (state.focus == null) return;
    const canvas = $("share-canvas");
    drawShareCard(canvas, state.focus);
    $("share-modal").hidden = false;
    const fileShare = $("share-native");
    fileShare.hidden = true;
    if (navigator.canShare && canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const file = new File([blob], `gita-${verses[state.focus].c}-${verses[state.focus].v}.png`, {
          type: "image/png",
        });
        if (navigator.canShare({ files: [file] })) {
          fileShare.hidden = false;
          fileShare.onclick = () => {
            track("share_native", { ref: verses[state.focus].c + "." + verses[state.focus].v });
            navigator.share({ files: [file], title: `Bhagavad Gita ${verses[state.focus].c}.${verses[state.focus].v}` });
          };
        }
      }, "image/png");
    }
  }

  $("panel-share").addEventListener("click", openShareModal);
  $("share-close").addEventListener("click", () => {
    $("share-modal").hidden = true;
  });
  $("share-modal").addEventListener("click", (e) => {
    if (e.target === $("share-modal")) $("share-modal").hidden = true;
  });
  $("share-download").addEventListener("click", () => {
    track("share_download", { ref: verses[state.focus].c + "." + verses[state.focus].v });
    const canvas = $("share-canvas");
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const v = verses[state.focus];
      a.download = `gita-${v.c}-${v.v}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  });

  /* -------------------------------------------------------- panel chrome */

  $("panel-prev").addEventListener("click", () => moveFocus(-1));
  $("panel-next").addEventListener("click", () => moveFocus(1));
  $("panel-close").addEventListener("click", closePanel);

  function moveFocus(delta) {
    if (state.focus == null) return;
    const next = Math.min(Math.max(state.focus + delta, 0), total - 1);
    openPanel(next);
  }

  $("panel-context").addEventListener("click", () => {
    if (state.focus == null) return;
    if (currentView === "threads") {
      const idx = state.focus;
      switchView("arcs");
      openPanel(idx);
      viz.animateViewTo(viz.chapterView(chapterOf[idx]));
    } else {
      viz.animateViewTo(viz.chapterView(chapterOf[state.focus]));
    }
  });

  function bindSectionToggle(buttonId, bodyId) {
    $(buttonId).addEventListener("click", () => {
      const body = $(bodyId);
      const expanded = !body.hidden;
      body.hidden = expanded;
      $(buttonId).setAttribute("aria-expanded", String(!expanded));
    });
  }
  bindSectionToggle("echoes-toggle", "echoes-body");
  bindSectionToggle("words-toggle", "words-body");
  bindSectionToggle("commentary-toggle", "commentary-body");

  $("panel-connects").addEventListener("click", () => {
    const body = $("conn-body");
    const expanded = body.style.display !== "none";
    body.style.display = expanded ? "none" : "";
    $("panel-connects").setAttribute("aria-expanded", String(!expanded));
  });

  viz.onFocus = (verse) => {
    if (state.journey) exitJourney(); // a manual click hands control back to the reader
    if (verse == null) closePanel();
    else openPanel(verse);
  };

  const searchInput = $("search-input");
  const searchResults = $("search-results");
  let searchActive = -1;
  let searchItems = [];

  searchInput.addEventListener("input", () => runSearch(searchInput.value));
  searchInput.addEventListener("focus", () => runSearch(searchInput.value));

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (searchItems.length) {
        e.preventDefault();
        searchActive = (searchActive + (e.key === "ArrowDown" ? 1 : -1) + searchItems.length) % searchItems.length;
        highlightSearch();
      }
    } else if (e.key === "Enter") {
      const target = searchItems[searchActive] || searchItems[0];
      if (target) {
        goToVerse(target.i);
        hideSearch();
        searchInput.blur();
      } else {
        const direct = parseRef(searchInput.value);
        if (direct != null) {
          goToVerse(direct);
          hideSearch();
          searchInput.blur();
        }
      }
    } else if (e.key === "Escape") {
      hideSearch();
      searchInput.blur();
    }
  });

  document.addEventListener("click", (e) => {
    if (!$("search-root").contains(e.target)) hideSearch();
  });

  function hideSearch() {
    searchResults.hidden = true;
    searchActive = -1;
  }

  function highlightSearch() {
    [...searchResults.children].forEach((el, i) => el.classList.toggle("is-active", i === searchActive));
  }

  function parseRef(q) {
    const m = q.trim().match(/^(?:bg)?\s*(\d{1,2})\s*[.: \-]\s*(\d{1,3})$/i);
    if (!m) return null;
    const c = Number(m[1]);
    const v = Number(m[2]);
    if (c < 1 || c > GITA.chapters.length) return null;
    for (let i = chapterStart[c - 1]; i < chapterEnd[c - 1]; i++) {
      if (verses[i].v === v) return i;
    }
    return null;
  }

  function runSearch(q) {
    q = q.trim();
    if (!q) {
      hideSearch();
      return;
    }
    searchItems = [];
    const direct = parseRef(q);
    if (direct != null) {
      searchItems.push({ i: direct, label: `${verses[direct].c}.${verses[direct].v}`, text: T(direct) });
    }

    const chapter = q.match(/^(?:ch(?:apter)?)?\s*(\d{1,2})$/i);
    if (chapter) {
      const c = Number(chapter[1]) - 1;
      if (c >= 0 && c < GITA.chapters.length) {
        searchItems.push({
          i: chapterStart[c],
          label: `Chapter ${c + 1}`,
          text: `${GITA.chapters[c].name} — ${GITA.chapters[c].gloss}`,
        });
      }
    }

    if (q.length >= 3) {
      const needle = q.toLowerCase();
      const found = [];
      for (let i = 0; i < total && found.length < 40; i++) {
        const idx = T(i).toLowerCase().indexOf(needle);
        if (idx >= 0) found.push({ i, idx });
        else if (verses[i].tr.toLowerCase().includes(needle)) found.push({ i, idx: -1 });
      }
      for (const f of found.slice(0, direct != null || chapter ? 6 : 8)) {
        const v = verses[f.i];
        let html;
        if (f.idx >= 0) {
          const start = Math.max(f.idx - 34, 0);
          const end = Math.min(f.idx + needle.length + 40, T(f.i).length);
          const pre = (start > 0 ? "…" : "") + T(f.i).slice(start, f.idx);
          const hit = T(f.i).slice(f.idx, f.idx + needle.length);
          const post = T(f.i).slice(f.idx + needle.length, end) + (end < T(f.i).length ? "…" : "");
          html = `${escapeHtml(pre)}<b>${escapeHtml(hit)}</b>${escapeHtml(post)}`;
        } else {
          html = escapeHtml(T(f.i).slice(0, 90));
        }
        searchItems.push({ i: f.i, label: `${v.c}.${v.v}`, html });
      }

      // The search can drive the lens: "show every verse containing this on the line".
      const lensSet = matchesForQuery(q);
      if (lensSet.size >= 3) {
        searchItems.unshift({
          lensAction: true,
          label: q,
          count: lensSet.size,
          indices: [...lensSet],
        });
      }
    }

    renderSearchResults(q);
  }

  function renderSearchResults(q) {
    searchResults.innerHTML = "";
    searchActive = -1;
    if (!searchItems.length) {
      searchResults.innerHTML = `<div class="search-empty">No matches for “${escapeHtml(q)}”</div>`;
      searchResults.hidden = false;
      return;
    }
    searchItems.forEach((item, i) => {
      const btn = document.createElement("button");
      if (item.lensAction) {
        btn.className = "search-result lens-action";
        btn.innerHTML = `<span class="r"><span class="lens-action-dot">◉</span> Show “${escapeHtml(
          item.label,
        )}” on the line</span><span class="t">${item.count} verses glow, chained across the Gita</span>`;
        btn.addEventListener("click", () => {
          setLensFromSet(item.label, new Set(item.indices));
          hideSearch();
          searchInput.blur();
        });
      } else {
        btn.className = "search-result";
        btn.innerHTML = `<span class="r">${item.label}</span><span class="t">${
          item.html || escapeHtml(item.text)
        }</span>`;
        btn.addEventListener("click", () => {
          goToVerse(item.i);
          hideSearch();
          searchInput.blur();
        });
      }
      searchResults.appendChild(btn);
    });
    searchResults.hidden = false;
  }

  function goToVerse(index) {
    openPanel(index);
    if (currentView === "threads") {
      threads.showVerse(index);
      return;
    }
    const visible = index >= viz.view.start && index < viz.view.end && viz.view.end - viz.view.start < total;
    if (!visible) viz.animateViewTo(viz.chapterView(chapterOf[index]));
  }

  function switchView(v) {
    if (currentView === v) return;
    currentView = v;
    document.querySelectorAll(".tab").forEach((t) => {
      const active = t.dataset.view === v;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", String(active));
    });
    document.body.dataset.view = v;
    $("threads-view").hidden = v !== "threads";
    viz.setHover(null);
    $("tooltip").hidden = true;
    exitJourney();
    closePanel();
    if (v === "threads") {
      threads.resize();
      threads.refresh();
      if (state.focus == null) openPanel(model.chapterStart[threads.chapter]);
    } else {
      viz.resize();
    }
    $("panel-context").innerHTML =
      v === "threads"
        ? `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M2 13a6 6 0 0 1 12 0M5.5 13a2.5 2.5 0 0 1 5 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <line x1="1.5" y1="13" x2="14.5" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg> Show in Arcs`
        : `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M2 3.5C3.5 2.6 5.5 2.6 8 3.8c2.5-1.2 4.5-1.2 6-.3v9c-1.5-.9-3.5-.9-6 .3-2.5-1.2-4.5-1.2-6-.3v-9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            <line x1="8" y1="3.8" x2="8" y2="12.6" stroke="currentColor" stroke-width="1.3"/>
          </svg> Read in context`;
  }

  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => switchView(t.dataset.view));
  });

  document.addEventListener("keydown", (e) => {
    if (!$("share-modal").hidden) {
      if (e.key === "Escape") $("share-modal").hidden = true;
      return;
    }
    if (e.target === searchInput || e.target.tagName === "INPUT") return;
    if (state.journey) {
      // The journey owns the arrows while it is running.
      if (e.key === "ArrowRight") journeyStep(1);
      else if (e.key === "ArrowLeft") journeyStep(-1);
      else if (e.key === "Escape") exitJourney();
      return;
    }
    if (e.key === "Escape") closePanel();
    else if (e.key === "ArrowLeft" && state.focus != null) moveFocus(-1);
    else if (e.key === "ArrowRight" && state.focus != null) moveFocus(1);
    else if (e.key === "/") {
      e.preventDefault();
      searchInput.focus();
    }
  });

  $("footer-home").addEventListener("click", (e) => {
    e.preventDefault();
    closePanel();
    viz.setView({ start: 0, end: total });
  });

  threads = new window.ThreadsView({
    root: $("threads-view"),
    canvas: $("threads-canvas"),
    list: $("threads-list"),
    titleEl: $("threads-title"),
    subEl: $("threads-sub"),
    prevBtn: $("threads-prev"),
    nextBtn: $("threads-next"),
    model,
    getIncident: (i) => state.incident[i],
    getSelected: () => state.focus,
    onSelect: (i) => openPanel(i),
    getText: T,
  });

  buildLegend();
  buildFilters();
  buildTranslationSelect();
  buildLensBar();
  buildJourneysPop();
  applyFilters();
  window.__viz = viz; 

  window.addEventListener("resize", () => viz.resize());

  const params = new URLSearchParams(location.search);
  const wordParam = params.get("word");
  if (wordParam) {
    const term = LENS_TERMS.find((t) => t.label === wordParam);
    if (term && term.verses.size) {
      setLens(term);
    } else {
      const set = matchesForQuery(wordParam); // free-text lens, e.g. ?word=death
      if (set.size >= 2) setLensFromSet(wordParam, set);
    }
  }
  const journeyParam = params.get("journey");
  if (journeyParam && window.JOURNEYS.some((j) => j.id === journeyParam)) {
    startJourney(journeyParam, Math.max(0, Number(params.get("step") || 1) - 1));
  } else {
    const refMatch = params.get("ref");
    if (refMatch) {
      const idx = parseRef(refMatch);
      if (idx != null) {
        goToVerse(idx);
      }
    }
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced) {
    const t0 = performance.now();
    const duration = 2300;
    const step = (now) => {
      const t = Math.min((now - t0) / duration, 1);
      viz.setReveal(1 - Math.pow(1 - t, 3));
      if (t < 1) requestAnimationFrame(step);
      else viz.setReveal(1);
    };
    viz.setReveal(0);
    requestAnimationFrame(step);
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
      });
    });
  }
})();
