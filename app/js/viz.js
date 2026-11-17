(function () {
  "use strict";

  const EDGE = 16;
  const AXIS_MARGIN = 32;
  const LABEL_BAND = 58;
  const VERTICAL_TOP_MARGIN = 48;
  const VERTICAL_LABEL_BAND = 64;
  const BAR_OFFSET = 3;
  const BAR_THICKNESS = 8;

  const TEXT = "#ecebe6";
  const MUTED = "#9a9890";
  const AXIS_COLOR = "#3a3935";
  const SURFACE = "#0d0d0d";
  const DIMMED_GLOW = 0.28;

  const LABEL_FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
  const SECTION_FONT = '600 10px system-ui, -apple-system, "Segoe UI", sans-serif';
  const TICK_FONT = '8.5px system-ui, -apple-system, "Segoe UI", sans-serif';

  const MIN_SPAN = 4;

  class ArcViz {
    constructor(canvas, model) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.glow = document.createElement("canvas");
      this.glowCtx = this.glow.getContext("2d");
      this.model = model;

      this.view = { start: 0, end: model.total };
      this.links = []; // [[a, b, score], ...] filtered similarity links
      this.phrases = []; // [[a, b, phrase, len], ...] literal Devanagari echoes
      this.incident = null; // verse index -> array of link indices (similarity)
      this.phraseIncident = null; // verse index -> array of phrase indices
      this.lensChain = null; // [[a, b], ...] concept-lens chain over matching verses
      this.lensVerses = null; // Set of verse indices matching the lens term
      this.hover = null;
      this.focus = null;
      this.reveal = 1;

      this.onHover = null; // (verseIndex|null, x, y) => void
      this.onFocus = null; // (verseIndex|null) => void
      this.onViewChange = null;

      this.#glowKey = "";
      this.#tween = null;
      this.#drag = null;

      this.#bind();
      this.resize();
    }

    #glowKey;
    #tween;
    #drag;

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      this.width = Math.max(rect.width, 50);
      this.height = Math.max(rect.height, 50);
      this.dpr = dpr;
      for (const [el, ctx] of [
        [this.canvas, this.ctx],
        [this.glow, this.glowCtx],
      ]) {
        el.width = Math.round(this.width * dpr);
        el.height = Math.round(this.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this.vertical = this.height > this.width * 1.15;
      this.layout = this.vertical
        ? {
            baseline: VERTICAL_LABEL_BAND,
            axisStart: VERTICAL_TOP_MARGIN,
            axisEnd: this.height - EDGE,
            maxArcHeight: Math.max(this.width - VERTICAL_LABEL_BAND - EDGE, 0),
          }
        : {
            baseline: this.height - LABEL_BAND,
            axisStart: AXIS_MARGIN,
            axisEnd: this.width - AXIS_MARGIN,
            maxArcHeight: Math.max(this.height - LABEL_BAND - EDGE, 0),
          };
      this.#glowKey = "";
      this.render();
    }

    setView(view, silent) {
      this.view = { start: view.start, end: view.end };
      this.#glowKey = "";
      this.render();
      if (!silent && this.onViewChange) this.onViewChange(this.view);
    }

    setLinks(links) {
      this.links = links;
      const incident = new Array(this.model.total);
      for (let i = 0; i < links.length; i++) {
        const [a, b] = links[i];
        (incident[a] || (incident[a] = [])).push(i);
        (incident[b] || (incident[b] = [])).push(i);
      }
      this.incident = incident;
      this.#glowKey = "";
      this.render();
    }

    setPhrases(phrases) {
      this.phrases = phrases;
      const incident = new Array(this.model.total);
      for (let i = 0; i < phrases.length; i++) {
        const [a, b] = phrases[i];
        (incident[a] || (incident[a] = [])).push(i);
        (incident[b] || (incident[b] = [])).push(i);
      }
      this.phraseIncident = incident;
      this.#glowKey = "";
      this.render();
    }

    setHover(index) {
      if (this.hover === index) return;
      this.hover = index;
      this.render();
    }
    setLens(chain, verses) {
      this.lensChain = chain;
      this.lensVerses = verses;
      this.#glowKey = "";
      this.render();
    }

    setFocus(index) {
      this.focus = index;
      this.render();
    }

    setReveal(r) {
      this.reveal = r;
      this.#glowKey = "";
      this.render();
    }

    pickVerse(x, y) {
      const { axisStart, axisEnd, baseline } = this.layout;
      if (this.vertical) {
        if (y < axisStart || y > axisEnd || x < baseline - 17 || x > this.width) return null;
      } else {
        if (x < axisStart || x > axisEnd || y < 0 || y > baseline + 17) return null;
      }
      const i = Math.floor(this.#alongToVerse(this.vertical ? y : x));
      if (i < 0 || i >= this.model.total) return null;
      return i;
    }

    pickChapter(x, y) {
      const { baseline, axisStart, axisEnd } = this.layout;
      let i;
      if (this.vertical) {
        if (x > baseline - 2 || y < axisStart || y > axisEnd) return null;
        i = Math.floor(this.#alongToVerse(y));
      } else {
        if (y < baseline + 2 || x < axisStart || x > axisEnd) return null;
        i = Math.floor(this.#alongToVerse(x));
      }
      if (i < 0 || i >= this.model.total) return null;
      return this.model.chapterOf[i];
    }

    animateViewTo(view, ms = 420) {
      if (this.#tween) cancelAnimationFrame(this.#tween);
      const from = { ...this.view };
      const to = this.#clampedView(view);
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min((now - t0) / ms, 1);
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.setView({
          start: from.start + (to.start - from.start) * e,
          end: from.end + (to.end - from.end) * e,
        });
        if (t < 1) this.#tween = requestAnimationFrame(step);
        else this.#tween = null;
      };
      this.#tween = requestAnimationFrame(step);
    }

    zoomBy(factor, along) {
      const v0 = Math.min(Math.max(along ?? (this.layout.axisStart + this.layout.axisEnd) / 2, 0), this.model.total);
      this.setView(
        this.#clampedView({
          start: v0 - (v0 - this.view.start) * factor,
          end: v0 + (this.view.end - v0) * factor,
        }),
      );
    }

    chapterView(chapter) {
      const pad = 1.5;
      return {
        start: this.model.chapterStart[chapter] - pad,
        end: this.model.chapterEnd[chapter] + pad,
      };
    }

    #ppx() {
      return (this.layout.axisEnd - this.layout.axisStart) / (this.view.end - this.view.start);
    }

    #verseToAlong(verse) {
      return this.layout.axisStart + (verse - this.view.start) * this.#ppx();
    }

    #alongToVerse(along) {
      return this.view.start + (along - this.layout.axisStart) / this.#ppx();
    }

    #axisPoint(along) {
      const alongPx = this.#verseToAlong(along);
      return this.vertical
        ? { x: this.layout.baseline, y: alongPx }
        : { x: alongPx, y: this.layout.baseline };
    }

    #fillAlong(ctx, alongFrom, alongTo, acrossFrom, acrossTo) {
      if (!this.vertical) {
        ctx.fillRect(alongFrom, acrossFrom, alongTo - alongFrom, acrossTo - acrossFrom);
        return;
      }
      const x = 2 * this.layout.baseline - acrossTo;
      ctx.fillRect(x, alongFrom, acrossTo - acrossFrom, alongTo - alongFrom);
    }

    #clampedView(view) {
      const total = this.model.total;
      let start = view.start;
      let end = view.end;
      if (end - start < MIN_SPAN) {
        const mid = (start + end) / 2;
        start = mid - MIN_SPAN / 2;
        end = mid + MIN_SPAN / 2;
      }
      if (end - start > total) {
        start = 0;
        end = total;
      }
      if (start < 0) {
        end -= start;
        start = 0;
      }
      if (end > total) {
        start -= end - total;
        end = total;
      }
      return { start, end };
    }

    #bind() {
      const c = this.canvas;

      c.addEventListener("wheel", (e) => {
        e.preventDefault();
        if (this.#tween) {
          cancelAnimationFrame(this.#tween);
          this.#tween = null;
        }
        const rect = c.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const factor = Math.exp((e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0016);
        this.zoomBy(factor, this.vertical ? y : x);
      }, { passive: false });

      c.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        c.setPointerCapture(e.pointerId);
        this.#drag = { x: e.clientX, y: e.clientY, moved: false };
      });

      c.addEventListener("pointermove", (e) => {
        const rect = c.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.#drag) {
          const dx = e.clientX - this.#drag.x;
          const dy = e.clientY - this.#drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) this.#drag.moved = true;
          if (this.#drag.moved) {
            if (this.#tween) {
              cancelAnimationFrame(this.#tween);
              this.#tween = null;
            }
            c.classList.add("is-panning");
            const dVerse = -(this.vertical ? dy : dx) / this.#ppx();
            this.#drag.x = e.clientX;
            this.#drag.y = e.clientY;
            this.setView(this.#clampedView({ start: this.view.start + dVerse, end: this.view.end + dVerse }));
          }
          return;
        }

        const verse = this.pickVerse(x, y);
        if (verse !== this.hover) this.setHover(verse);
        if (this.onHover) this.onHover(verse, x, y);
      });

      const endDrag = (e) => {
        if (!this.#drag) return;
        const wasDrag = this.#drag.moved;
        this.#drag = null;
        c.classList.remove("is-panning");
        if (wasDrag) return;
        const rect = c.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (this.onFocus) {
          const chapter = this.pickChapter(x, y);
          if (chapter != null) {
            this.animateViewTo(this.chapterView(chapter));
            this.onFocus(null);
          } else {
            const verse = this.pickVerse(x, y);
            if (verse != null) this.onFocus(verse);
          }
        }
      };

      c.addEventListener("pointerup", endDrag);
      c.addEventListener("pointercancel", () => {
        this.#drag = null;
        c.classList.remove("is-panning");
      });

      c.addEventListener("pointerleave", () => {
        if (this.#drag) return;
        this.setHover(null);
        if (this.onHover) this.onHover(null, 0, 0);
      });

      c.addEventListener("dblclick", (e) => {
        const rect = c.getBoundingClientRect();
        const along = this.vertical ? e.clientY - rect.top : e.clientX - rect.left;
        this.animateViewTo(
          this.#clampedView({
            start: this.#alongToVerse(along) - (this.view.end - this.view.start) / 4,
            end: this.#alongToVerse(along) + (this.view.end - this.view.start) / 4,
          }),
          320,
        );
      });

      new ResizeObserver(() => this.resize()).observe(c.parentElement || c);
    }

    render() {
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = SURFACE;
      ctx.fillRect(0, 0, this.width, this.height);

      this.#renderGlow();

      const dim = this.focus != null;
      const lens = this.lensChain != null;
      ctx.globalAlpha = lens ? 0.12 : dim ? DIMMED_GLOW : 0.9;
      ctx.filter = "blur(2.1px) saturate(1.32)";
      ctx.drawImage(this.glow, 0, 0, this.width, this.height);
      ctx.globalAlpha = lens ? 0.05 : dim ? 0.1 : 0.62;
      ctx.filter = "none";
      ctx.drawImage(this.glow, 0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
      ctx.filter = "none";

      this.#paintAxis();

      if (lens) this.#paintLensChain();
      if (this.hover != null) this.#paintIncident(this.hover, 1.4, 0.85);
      if (this.focus != null) this.#paintIncident(this.focus, 1.8, 0.95);
      ctx.restore();
    }

    #paintLensChain() {
      const ctx = this.ctx;
      const colors = this.model.sectionColors;
      // Accent ticks under every matching verse on the bar.
      const barFrom = this.layout.baseline + BAR_OFFSET;
      const barTo = barFrom + BAR_THICKNESS;
      for (const i of this.lensVerses) {
        const p = this.#axisPoint(i);
        const along = this.vertical ? p.y : p.x;
        if (along < this.layout.axisStart || along > this.layout.axisEnd) continue;
        const w = Math.max(this.#ppx(), 2);
        ctx.fillStyle = "rgb(245 158 11 / 0.95)";
        this.#fillAlong(ctx, along, along + Math.min(w, 6), barFrom - 2, barTo + 2);
      }
      // The chain: consecutive matching verses linked in order.
      for (const [a, b] of this.lensChain) {
        const pa = this.#axisPoint(a);
        const pb = this.#axisPoint(b);
        const ca = colors[this.model.sectionOfVerse[a]];
        const cb = colors[this.model.sectionOfVerse[b]];
        let style = ca;
        if (ca !== cb) {
          const grad = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
          grad.addColorStop(0, ca);
          grad.addColorStop(1, cb);
          style = grad;
        }
        this.#strokeArc(ctx, a, b, style, 1.7, 0.95, 1);
      }
    }

    #strokeArc(ctx, a, b, style, width, alpha, reveal = this.reveal) {
      const { baseline } = this.layout;
      const pa = this.#axisPoint(a);
      const pb = this.#axisPoint(b);
      const span = Math.abs(pb.x - pa.x) + Math.abs(pb.y - pa.y); // one of them is 0
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.globalAlpha = alpha;
      if (span < 2.2) {
        const h = Math.min(span / 2, this.layout.maxArcHeight) * reveal;
        if (h < 0.4) return;
        ctx.beginPath();
        if (this.vertical) {
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pa.x + h, pa.y);
        } else {
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pa.x, pa.y - h);
        }
        ctx.stroke();
        return;
      }
      const half = span / 2;
      const ry = Math.min(half, this.layout.maxArcHeight);
      ctx.beginPath();
      if (this.vertical) {
        ctx.ellipse(baseline, (pa.y + pb.y) / 2, ry, half, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * reveal);
      } else {
        ctx.ellipse((pa.x + pb.x) / 2, baseline, half, ry, 0, Math.PI, Math.PI + Math.PI * reveal);
      }
      ctx.stroke();
    }

    #renderGlow() {
      const key = [
        this.links.length,
        this.phrases.length,
        this.view.start.toFixed(4),
        this.view.end.toFixed(4),
        this.width,
        this.height,
        this.reveal.toFixed(3),
      ].join("|");
      if (key === this.#glowKey) return;
      this.#glowKey = key;

      const g = this.glowCtx;
      g.clearRect(0, 0, this.width, this.height);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.5;
      g.lineWidth = 0.8;
      g.lineCap = "round";

      const colors = this.model.sectionColors;
      const { axisStart, axisEnd } = this.layout;

      // 0 = off-screen, 1 = one endpoint visible, 2 = spans the whole window.
      const visibility = (a, b) => {
        const pa = this.#axisPoint(a);
        const pb = this.#axisPoint(b);
        const alongOf = (p) => (this.vertical ? p.y : p.x);
        const inView = (p) => {
          const t = alongOf(p);
          return t >= axisStart - 40 && t <= axisEnd + 40;
        };
        if (inView(pa) || inView(pb)) return 1;
        const bothAbove = alongOf(pa) < axisStart - 40 && alongOf(pb) < axisStart - 40;
        const bothBelow = alongOf(pa) > axisEnd + 40 && alongOf(pb) > axisEnd + 40;
        if (bothAbove || bothBelow) return 0;
        return 2;
      };

      for (const [a, b] of this.links) {
        const vis = visibility(a, b);
        if (!vis) continue;
        const ca = colors[this.model.sectionOfVerse[a]];
        const cb = colors[this.model.sectionOfVerse[b]];
        let style;
        if (ca === cb) {
          style = ca;
        } else {
          const pa = this.#axisPoint(a);
          const pb = this.#axisPoint(b);
          const grad = g.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
          grad.addColorStop(0, ca);
          grad.addColorStop(1, cb);
          style = grad;
        }
        this.#strokeArc(g, a, b, style, 0.8, vis === 2 ? 0.12 : 0.5);
      }

      // Sanskrit phrase echoes: ivory hairlines over the same glow pipeline.
      g.strokeStyle = TEXT;
      for (const [a, b] of this.phrases) {
        const vis = visibility(a, b);
        if (!vis) continue;
        this.#strokeArc(g, a, b, TEXT, 0.8, vis === 2 ? 0.14 : 0.55);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }

    #paintIncident(verse, width, alpha) {
      const links = this.incident && this.incident[verse];
      const phrases = this.phraseIncident && this.phraseIncident[verse];
      if ((!links || !links.length) && (!phrases || !phrases.length)) return;
      const ctx = this.ctx;
      const colors = this.model.sectionColors;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.lineCap = "round";
      for (const li of links || []) {
        const [a, b] = this.links[li];
        const pa = this.#axisPoint(a);
        const pb = this.#axisPoint(b);
        const ca = colors[this.model.sectionOfVerse[a]];
        const cb = colors[this.model.sectionOfVerse[b]];
        let style = ca;
        if (ca !== cb) {
          const grad = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
          grad.addColorStop(0, ca);
          grad.addColorStop(1, cb);
          style = grad;
        }
        this.#strokeArc(ctx, a, b, style, width, alpha, 1);
      }
      for (const pi of phrases || []) {
        const [a, b] = this.phrases[pi];
        this.#strokeArc(ctx, a, b, TEXT, width, Math.min(alpha + 0.05, 1), 1);
      }
      ctx.restore();
    }

    #paintAxis() {
      const ctx = this.ctx;
      const { baseline, axisStart, axisEnd } = this.layout;
      const barFrom = baseline + BAR_OFFSET;
      const barTo = barFrom + BAR_THICKNESS;
      const m = this.model;
      const ppx = this.#ppx();

      // Axis line.
      ctx.fillStyle = AXIS_COLOR;
      this.#fillAlong(ctx, axisStart, axisEnd, baseline, baseline + 1);

      const clamp = (v) => Math.min(Math.max(v, axisStart), axisEnd);

      for (let c = 0; c < m.chapterStart.length; c++) {
        const from = this.#verseToAlong(m.chapterStart[c]);
        const to = this.#verseToAlong(m.chapterEnd[c]);
        if (to < axisStart || from > axisEnd) continue;
        const gap = to - from > 4 ? 1 : 0;
        ctx.globalAlpha = c % 2 === 0 ? 1 : 0.72;
        ctx.fillStyle = m.sectionColors[m.sectionOfChapter[c]];
        this.#fillAlong(ctx, clamp(from) + gap, clamp(to) - gap, barFrom, barTo);
      }
      ctx.globalAlpha = 1;

      if (ppx > 9) {
        ctx.fillStyle = MUTED;
        const first = Math.max(Math.floor(this.#alongToVerse(axisStart)), 0);
        const last = Math.min(Math.ceil(this.#alongToVerse(axisEnd)), m.total - 1);
        for (let i = first; i <= last; i++) {
          const p = this.#verseToAlong(i);
          if (p >= axisStart && p <= axisEnd) {
            this.#fillAlong(ctx, p, p + 1, barTo + 1, barTo + 4);
          }
        }
      }

      const mark = (index, color, minW, grow) => {
        if (index == null) return;
        const from = clamp(this.#verseToAlong(index));
        const to = clamp(this.#verseToAlong(index + 1));
        const center = (from + to) / 2;
        const half = Math.max((to - from) / 2, minW / 2);
        ctx.fillStyle = color;
        this.#fillAlong(ctx, center - half, center + half, barFrom - grow, barTo + grow);
      };
      mark(this.hover, "rgb(236 235 230 / 0.45)", 1.5, 2);
      mark(this.focus, TEXT, 2, 2);

      // Chapter labels.
      ctx.font = LABEL_FONT;
      ctx.textBaseline = "middle";
      ctx.textAlign = this.vertical ? "right" : "center";
      for (let c = 0; c < m.chapterStart.length; c++) {
        const from = Math.max(this.#verseToAlong(m.chapterStart[c]), axisStart);
        const to = Math.min(this.#verseToAlong(m.chapterEnd[c]), axisEnd);
        const room = to - from;
        if (room <= 0) continue;
        const chapter = m.chapters[c];
        let label;
        if (this.vertical) {
          const sideRoom = baseline - BAR_OFFSET - BAR_THICKNESS - 8;
          label =
            ctx.measureText(chapter.abbr).width <= sideRoom
              ? chapter.abbr
              : room >= 12
                ? String(chapter.n)
                : null;
        } else {
          label =
            room >= ctx.measureText(chapter.abbr).width + 8
              ? chapter.abbr
              : room >= 14
                ? String(chapter.n)
                : null;
        }
        if (!label) continue;
        const active =
          (this.hover != null && m.chapterOf[this.hover] === c) ||
          (this.focus != null && m.chapterOf[this.focus] === c);
        ctx.fillStyle = active ? TEXT : MUTED;
        if (this.vertical) {
          ctx.fillText(label, baseline - BAR_OFFSET - BAR_THICKNESS - 5, (from + to) / 2);
        } else {
          ctx.fillText(label, (from + to) / 2, barTo + 12);
        }
      }

      // Verse numbers when deeply zoomed.
      if (ppx >= 26) {
        ctx.font = TICK_FONT;
        ctx.fillStyle = "rgb(154 152 144 / 0.75)";
        ctx.textAlign = this.vertical ? "right" : "center";
        const first = Math.max(Math.floor(this.#alongToVerse(axisStart)), 0);
        const last = Math.min(Math.ceil(this.#alongToVerse(axisEnd)), m.total - 1);
        for (let i = first; i <= last; i++) {
          const p = this.#verseToAlong(i);
          if (this.vertical) {
            this.#fillAlongText(ctx, String(m.verses[i].v), barTo + 25, p + ppx / 2);
          } else {
            ctx.fillText(String(m.verses[i].v), p + ppx / 2, barTo + 25);
          }
        }
      }
      if (!this.vertical) {
        ctx.font = SECTION_FONT;
        ctx.textAlign = "center";
        const secY = barTo + 38;
        for (const s of m.sections) {
          const firstCh = s.chapters[0] - 1;
          const lastCh = s.chapters[s.chapters.length - 1] - 1;
          const from = Math.max(this.#verseToAlong(m.chapterStart[firstCh]), axisStart);
          const to = Math.min(this.#verseToAlong(m.chapterEnd[lastCh]), axisEnd);
          const label = s.name.toUpperCase();
          const textWidth = ctx.measureText(label).width;
          if (to - from < textWidth + 16) continue;
          const center = (from + to) / 2;
          ctx.fillStyle = s.color;
          ctx.fillRect(center - textWidth / 2 - 12, secY - 1, 8, 2);
          ctx.fillStyle = MUTED;
          ctx.fillText(label, center + 2, secY);
        }
      }

      if (this.view.end - this.view.start < m.total - 0.5) {
        const length = (this.vertical ? this.height : this.width) - 64;
        const offset = 32;
        const pos = (verse) => offset + (verse / m.total) * length;
        for (const s of m.sections) {
          const firstCh = s.chapters[0] - 1;
          const lastCh = s.chapters[s.chapters.length - 1] - 1;
          ctx.fillStyle = s.color;
          const from = pos(m.chapterStart[firstCh]);
          const to = pos(m.chapterEnd[lastCh]);
          if (this.vertical) ctx.fillRect(this.width - 9, from, 3, to - from);
          else ctx.fillRect(from, 7, to - from, 3);
        }
        ctx.strokeStyle = TEXT;
        ctx.lineWidth = 1;
        const from = pos(this.view.start);
        const to = pos(this.view.end);
        if (this.vertical) {
          ctx.strokeRect(this.width - 13.5, from - 0.5, 10, Math.max(to - from, 3) + 1);
        } else {
          ctx.strokeRect(from - 0.5, 3.5, Math.max(to - from, 3) + 1, 10);
        }
      }
    }

    #fillAlongText(ctx, text, across, along) {
      ctx.textAlign = "right";
      ctx.fillText(text, 2 * this.layout.baseline - across, along);
    }
  }

  window.ArcViz = ArcViz;
})();
