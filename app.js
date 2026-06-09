// ============================================================
//  Dashboard — shared behavior
//  Theme toggle · mobile sidebar · SVG charts · count-up · table sort
// ============================================================
(function () {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Theme (persisted) ---------- */
  const saved = localStorage.getItem('theme');
  if (saved) root.setAttribute('data-theme', saved);
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) root.setAttribute('data-theme', 'dark');

  function setThemeIcon() {
    const dark = root.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('[data-action="toggle-theme"]').forEach(function (b) {
      b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      b.querySelector('.i-sun')?.toggleAttribute('hidden', !dark);
      b.querySelector('.i-moon')?.toggleAttribute('hidden', dark);
    });
  }
  setThemeIcon();

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-action="toggle-theme"]')) {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      setThemeIcon();
      requestAnimationFrame(renderAllCharts); // re-tint theme-dependent charts
    }
    if (e.target.closest('[data-action="toggle-menu"]')) {
      document.querySelector('.sidebar')?.classList.toggle('open');
      document.querySelector('.scrim')?.toggleAttribute('hidden');
    }
    if (e.target.classList.contains('scrim')) {
      document.querySelector('.sidebar')?.classList.remove('open');
      e.target.setAttribute('hidden', '');
    }
  });

  /* ---------- Helpers ---------- */
  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  /* ---------- Line / area chart -----------------------------------------
     <figure class="linechart" data-values="12,18,..." data-labels="Jan,Feb,..."
             role="img" aria-label="..."></figure>
  ----------------------------------------------------------------------- */
  function renderLineChart(fig) {
    const values = fig.dataset.values.split(',').map(Number);
    const labels = (fig.dataset.labels || '').split(',').filter(Boolean);
    const W = 640, H = 240, pad = { l: 8, r: 8, t: 16, b: 12 };
    const max = Math.max.apply(null, values) * 1.12;
    const min = Math.min.apply(null, values.concat(0));
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const x = function (i) { return pad.l + (i / (values.length - 1)) * iw; };
    const y = function (v) { return pad.t + ih - ((v - min) / (max - min)) * ih; };

    const stroke = cssVar('--color-secondary');
    const fill = cssVar('--color-primary');
    fig.innerHTML = '';
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', class: 'chart-svg' });

    for (let g = 0; g <= 3; g++) {
      const gy = pad.t + (ih / 3) * g;
      svg.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: gy, y2: gy, class: 'grid' }));
    }
    const id = 'g' + Math.round(values[0] * 97 + values.length);
    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': fill, 'stop-opacity': '.28' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': fill, 'stop-opacity': '0' }));
    defs.appendChild(grad); svg.appendChild(defs);

    let d = '', area = '';
    values.forEach(function (v, i) {
      const px = x(i), py = y(v);
      d += (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1) + ' ';
      area += (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1) + ' ';
    });
    area += 'L' + x(values.length - 1).toFixed(1) + ' ' + (pad.t + ih) + ' L' + x(0) + ' ' + (pad.t + ih) + ' Z';

    svg.appendChild(svgEl('path', { d: area, fill: 'url(#' + id + ')', stroke: 'none' }));
    const line = svgEl('path', { d: d.trim(), fill: 'none', stroke: stroke, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'chart-line' });
    svg.appendChild(line);

    values.forEach(function (v, i) {
      const dot = svgEl('circle', { cx: x(i), cy: y(v), r: 4, class: 'chart-dot', fill: stroke });
      const title = svgEl('title', {});
      title.textContent = (labels[i] || ('#' + (i + 1))) + ': ' + v.toLocaleString();
      dot.appendChild(title);
      svg.appendChild(dot);
    });

    if (!reduceMotion) {
      const len = line.getTotalLength();
      line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
      line.getBoundingClientRect();
      line.style.transition = 'stroke-dashoffset 900ms ease-out';
      line.style.strokeDashoffset = '0';
    }
    fig.appendChild(svg);

    if (labels.length) {
      const cap = document.createElement('div');
      cap.className = 'chart-xlabels';
      labels.forEach(function (l) { const s = document.createElement('span'); s.textContent = l; cap.appendChild(s); });
      fig.appendChild(cap);
    }
  }

  /* ---------- Sparkline (KPI cards) ----------------------------------- */
  function renderSpark(el) {
    const values = el.dataset.spark.split(',').map(Number);
    const W = 120, H = 36;
    const max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    const x = function (i) { return (i / (values.length - 1)) * W; };
    const y = function (v) { return H - 2 - ((v - min) / (max - min || 1)) * (H - 4); };
    const up = values[values.length - 1] >= values[0];
    const color = up ? cssVar('--color-success') : cssVar('--color-destructive');
    let d = '';
    values.forEach(function (v, i) { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; });
    el.innerHTML = '';
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'spark-svg', 'aria-hidden': 'true' });
    svg.appendChild(svgEl('path', { d: d.trim(), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    el.appendChild(svg);
  }

  /* ---------- Count-up KPI numbers ------------------------------------ */
  function countUp(el) {
    const target = parseFloat(el.dataset.count);
    const prefix = el.dataset.prefix || '', suffix = el.dataset.suffix || '';
    const decimals = (el.dataset.decimals | 0);
    const fmt = function (n) { return prefix + n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix; };
    if (reduceMotion) { el.textContent = fmt(target); return; }
    const dur = 1100; let start = null;
    function step(ts) {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      el.textContent = fmt(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------- Sortable tables ---------------------------------------- */
  function wireSortableTables() {
    document.querySelectorAll('table[data-sortable] thead th[data-sort]').forEach(function (th) {
      th.tabIndex = 0; th.setAttribute('role', 'button'); th.setAttribute('aria-sort', 'none');
      function sort() {
        const table = th.closest('table');
        const tbody = table.querySelector('tbody');
        const col = Array.from(th.parentNode.children).indexOf(th);
        const dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
        table.querySelectorAll('thead th').forEach(function (h) { h.setAttribute('aria-sort', 'none'); });
        th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
        const numeric = th.dataset.sort === 'number';
        Array.from(tbody.querySelectorAll('tr')).sort(function (a, b) {
          let av = a.children[col].dataset.value ?? a.children[col].textContent.trim();
          let bv = b.children[col].dataset.value ?? b.children[col].textContent.trim();
          if (numeric) { av = parseFloat(String(av).replace(/[^0-9.-]/g, '')); bv = parseFloat(String(bv).replace(/[^0-9.-]/g, '')); return (av - bv) * dir; }
          return String(av).localeCompare(String(bv)) * dir;
        }).forEach(function (r) { tbody.appendChild(r); });
      }
      th.addEventListener('click', sort);
      th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
    });
  }

  function renderAllCharts() {
    document.querySelectorAll('.linechart').forEach(renderLineChart);
    document.querySelectorAll('[data-spark]').forEach(renderSpark);
  }

  /* ---------- Boot ---------- */
  function boot() {
    renderAllCharts();
    document.querySelectorAll('[data-count]').forEach(countUp);
    wireSortableTables();
    const clock = document.getElementById('live-clock');
    if (clock) {
      const tick = function () { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
      tick(); setInterval(tick, 1000);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
