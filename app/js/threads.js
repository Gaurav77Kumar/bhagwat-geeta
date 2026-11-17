(function () {
  "use strict";

  const TEXT = "#ecebe6";
  const MUTED = "#9a9890";
  const BAR_W = 10;
  const BAR_MARGIN = 14;

  class ThreadsView {
    constructor(opts) {
      this.root = opts.root;
      this.canvas = opts.canvas;
      this.ctx = this.canvas.getContext("2d");
      this.listEl = opts.list;
      this.titleEl = opts.titleEl;
      this.subEl = opts.subEl;
      this.model = opts.model;
      this.getIncident = opts.getIncident;
      this.getSelected = opts.getSelected;
      this.onSelect = opts.onSelect;
      this.getText = opts.getText || ((i) => this.model.verses[i].en);

      this.chapter = 1; // 0-based; the Gita's heart
      this.hoverVerse = null;
      this.hoverChapter = null;
      this.prevBtn = opts.prevBtn;
      this.nextBtn = opts.nextBtn;

      this.prevBtn.addEventListener("click", () => this.setChapter(this.chapter - 1));
      this.nextBtn.addEventListener("click", () => this.setChapter(this.chapter + 1));

      this.listEl.addEventListener("mouseover", (e) => {
        const row = e.target.closest(".thread-row");
        const idx = row ? Number(row.dataset.i) : null;
        if (idx !== this.hoverVerse) {
          this.hoverVerse = idx;
          this.#syncRowHover();
          this.render();
        }
      });
      this.listEl.addEventListener("mouseleave", () => {
        if (this.hoverVerse != null) {
          this.hoverVerse = null;
          this.#syncRowHover();
          this.render();
        }
      });
      this.listEl.addEventListener("click", (e) => {
        const row = e.target.closest(".thread-row");
        if (row) this.onSelect(Number(row.dataset.i));
      });
      this.listEl.addEventListener("scroll", () => {
        if (!this.#scrollRaf) {
          this.#scrollRaf = requestAnimationFrame(() => {
            this.#scrollRaf = 0;
            this.render();
          });
        }
      });

      this.canvas.addEventListener("pointermove", (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const chapter = this.#chapterAt(e.clientX - rect.left, e.clientY - rect.top);
        if (chapter !== this.hoverChapter) {
          this.hoverChapter = chapter;
          this.render();
        }
      });
      this.canvas.addEventListener("pointerleave", () => {
        if (this.hoverChapter != null) {
          this.hoverChapter = null;
          this.render();
        }
      });

      new ResizeObserver(() => this.resize()).observe(this.root);
      this.resize();
    }

    #scrollRaf = 0;

    setChapter(c, selectVerse = true) {
      const m = this.model;
      this.chapter = Math.min(Math.max(c, 0), m.chapterStart.length - 1);
      const first = m.chapterStart[this.chapter];
      this.renderList();
      this.#syncNav();
      if (selectVerse && this.onSelect) this.onSelect(first);
      else this.render();
    }

    showVerse(index) {
      const c = this.model.chapterOf[index];
      if (c !== this.chapter) {
        this.chapter = c;
        this.renderList();
        this.#syncNav();
      }
      const row = this.listEl.querySelector(`.thread-row[data-i="${index}"]`);
      if (row) {
        const view = this.listEl;
        const top = row.offsetTop;
        if (top < view.scrollTop || top + row.offsetHeight > view.scrollTop + view.clientHeight) {
          view.scrollTop = top - view.clientHeight / 2 + row.offsetHeight / 2;
        }
      }
      this.syncSelection();
    }

    refresh() {
      const top = this.listEl.scrollTop;
      this.renderList();
      this.#syncNav();
      this.listEl.scrollTop = top;
      this.render();
    }

    syncSelection() {
      this.#syncRowHover();
      this.render();
    }

    #syncNav() {
      this.prevBtn.disabled = this.chapter === 0;
      this.nextBtn.disabled = this.chapter === this.model.chapterStart.length - 1;
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      this.width = Math.max(rect.width, 50);
      this.height = Math.max(rect.height, 50);
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.render();
    }

    renderList() {
      const m = this.model;
      const ch = m.chapters[this.chapter];
      const sec = m.sections[m.sectionOfChapter[this.chapter]];
      this.titleEl.textContent = ch.name;
      this.subEl.innerHTML =
        `<span class="dash" style="--c:${sec.color}"></span>Chapter ${ch.n} · ${ch.verses} verses · ${sec.name}`;

      const first = m.chapterStart[this.chapter];
      const last = m.chapterEnd[this.chapter];
      let html = "";
      for (let i = first; i < last; i++) {
        const v = m.verses[i];
        const count = (this.getIncident(i) || []).length;
        html += `<button class="thread-row" data-i="${i}">
          <span class="n">${v.v}</span>
          <span class="t">${escapeHtml(this.getText(i))}</span>
          <span class="c" title="connections">${count || ""}</span>
        </button>`;
      }
      this.listEl.innerHTML = html;
      this.#syncRowHover();
    }

    #syncRowHover() {
      const selected = this.getSelected();
      for (const row of this.listEl.children) {
        const i = Number(row.dataset.i);
        row.classList.toggle("is-hover", i === this.hoverVerse);
        row.classList.toggle("is-selected", i === selected);
      }
    }

    #barX() {
      const rootRect = this.root.getBoundingClientRect();
      const canvasRect = this.canvas.getBoundingClientRect();
      const listLeft = canvasRect.left - rootRect.left;
      const stageW = rootRect.width;
      const pageBar = Math.min(stageW * 0.56, stageW - 517);
      return Math.max(pageBar - listLeft, 40);
    }

    #barGeometry() {
      const m = this.model;
      const h = this.height - BAR_MARGIN * 2;
      const geo = [];
      let y = BAR_MARGIN;
      for (let c = 0; c < m.chapterStart.length; c++) {
        const segH = (h * (m.chapterEnd[c] - m.chapterStart[c])) / m.total;
        geo.push({ y, h: segH });
        y += segH;
      }
      return geo;
    }

    #chapterAt(x, y) {
      if (x < this.#barX() - 26) return null;
      const geo = this.#barGeometry();
      for (let c = 0; c < geo.length; c++) {
        if (y >= geo[c].y && y < geo[c].y + geo[c].h) return c;
      }
      return null;
    }

    #rowCenter(verseIndex) {
      const row = this.listEl.children[verseIndex - this.model.chapterStart[this.chapter]];
      if (!row) return null;
      return row.offsetTop + row.offsetHeight / 2 - this.listEl.scrollTop;
    }

    render() {
      const ctx = this.ctx;
      const m = this.model;
      ctx.clearRect(0, 0, this.width, this.height);
      if (!this.listEl.children.length) return;

      const barX = this.#barX();
      const geo = this.#barGeometry();
      const selected = this.getSelected();

      const plain = [];
      const emph = [];
      for (let i = m.chapterStart[this.chapter]; i < m.chapterEnd[this.chapter]; i++) {
        const conns = this.getIncident(i) || [];
        const rowEmph = i === selected || i === this.hoverVerse;
        for (const { other } of conns) {
          const target = m.chapterOf[other];
          const isEmph = rowEmph || (this.hoverChapter != null && target === this.hoverChapter);
          const dim = this.hoverChapter != null && target !== this.hoverChapter;
          (isEmph ? emph : plain).push({ from: i, target, dim });
        }
      }

      const drawThread = ({ from, target, dim }, emphasized) => {
        const y0 = this.#rowCenter(from);
        if (y0 == null) return;
        const y1 = geo[target].y + geo[target].h / 2;
        ctx.strokeStyle = m.sectionColors[m.sectionOfChapter[target]];
        ctx.globalAlpha = emphasized ? 0.9 : dim ? 0.1 : 0.38;
        ctx.lineWidth = emphasized ? 1.6 : 1.1;
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.bezierCurveTo(barX * 0.5, y0, barX - barX * 0.14, y1, barX, y1);
        ctx.stroke();
      };
      for (const t of plain) drawThread(t, false);
      for (const t of emph) drawThread(t, true);
      ctx.globalAlpha = 1;

      for (let c = 0; c < geo.length; c++) {
        const g = geo[c];
        ctx.globalAlpha = c % 2 === 0 ? 1 : 0.72;
        ctx.fillStyle = m.sectionColors[m.sectionOfChapter[c]];
        ctx.fillRect(barX, g.y + 0.5, BAR_W, Math.max(g.h - 1, 0.5));
      }
      ctx.globalAlpha = 1;
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (let c = 0; c < geo.length; c++) {
        const g = geo[c];
        const cy = g.y + g.h / 2;
        if (cy < 4 || cy > this.height - 4) continue;
        const active =
          c === this.hoverChapter ||
          c === this.chapter ||
          (selected != null && m.chapterOf[selected] === c);
        ctx.fillStyle = active ? TEXT : MUTED;
        ctx.fillText(`${m.chapters[c].n} · ${m.chapters[c].abbr}`, barX + BAR_W + 8, cy);
      }
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  window.ThreadsView = ThreadsView;
})();
