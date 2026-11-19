/*
 * CDT Atacado System - quick order analytics.
 * compute() is pure (testable in Node); render() draws the analysis view.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./order-core.js'));
  else root.OrderAnalysis = factory(root.OrderCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  // Period presets -> [from, to) dates. "now" is injectable for tests.
  function periodRange(period, now) {
    const d = now || new Date();
    const y = d.getFullYear(), m = d.getMonth();
    switch (period) {
      case 'this-month': return [new Date(y, m, 1), new Date(y, m + 1, 1)];
      case 'last-month': return [new Date(y, m - 1, 1), new Date(y, m, 1)];
      case 'last-30': return [new Date(d.getTime() - 30 * 864e5), new Date(d.getTime() + 864e5)];
      case 'this-year': return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
      default: return [null, null];
    }
  }

  // Order value: the total saved with the order (prices at that time); falls back to recomputing.
  function orderCents(o, index) {
    if (Number.isFinite(o.totalCents)) return o.totalCents;
    return C.summarize(o.cart || {}, index).totalCents;
  }

  function compute(orders, index, filter) {
    const f = filter || {};
    const [from, to] = periodRange(f.period, f.now);
    const q = (f.query || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const list = (orders || []).filter((o) => {
      const t = new Date(o.createdAt);
      if (from && (t < from || t >= to)) return false;
      if (q) {
        const c = o.customer || {};
        const hay = [o.number, c.store, c.doc, c.phone, c.address, c.city].join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    let revenue = 0, fardos = 0, displays = 0, freight = 0;
    const byMonth = {}, byDay = {}, byCustomer = {}, byPayment = {}, byItem = {};
    const rows = list.map((o) => {
      const s = C.summarize(o.cart || {}, index, o.packaging);
      const cents = orderCents(o, index);
      const c = o.customer || {};
      revenue += cents; fardos += s.totalFardos; displays += s.totalDisplays; freight += o.freightCents || 0;
      const t = new Date(o.createdAt);
      const mk = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
      const dk = mk + '-' + String(t.getDate()).padStart(2, '0');
      (byMonth[mk] = byMonth[mk] || { key: mk, cents: 0, orders: 0 }); byMonth[mk].cents += cents; byMonth[mk].orders++;
      (byDay[dk] = byDay[dk] || { key: dk, cents: 0, orders: 0 }); byDay[dk].cents += cents; byDay[dk].orders++;
      const ck = (c.store || '').trim() || 'Sem nome';
      (byCustomer[ck] = byCustomer[ck] || { name: ck, cents: 0, orders: 0, fardos: 0 });
      byCustomer[ck].cents += cents; byCustomer[ck].orders++; byCustomer[ck].fardos += s.totalFardos;
      const pk = [c.paymentMethod || c.payment, c.paymentTerm].filter(Boolean).join(' · ') || 'A combinar';
      (byPayment[pk] = byPayment[pk] || { name: pk, cents: 0, orders: 0 }); byPayment[pk].cents += cents; byPayment[pk].orders++;
      s.lines.forEach((l) => {
        if (l.type === 'display') return;
        const ik = l.type + ':' + l.id;
        (byItem[ik] = byItem[ik] || { name: l.name, type: l.type, cents: 0, fardos: 0 });
        byItem[ik].cents += l.subtotalCents; byItem[ik].fardos += l.fardos;
      });
      return { number: o.number, createdAt: o.createdAt, customer: ck, payment: pk, fardos: s.totalFardos, displays: s.totalDisplays, freight: o.freightCents || 0, cents: cents };
    });

    const desc = (a, b) => b.cents - a.cents || a.name.localeCompare(b.name, 'pt-BR');
    const months = Object.values(byMonth).sort((a, b) => a.key.localeCompare(b.key));
    // Few months in range -> show days instead so the chart still says something.
    const useDays = months.length <= 1;
    const series = (useDays ? Object.values(byDay) : months).sort((a, b) => a.key.localeCompare(b.key)).map((b) => {
      const [yy, mm, dd] = b.key.split('-');
      return Object.assign({}, b, { label: useDays ? dd + '/' + mm : MONTHS[Number(mm) - 1] + '/' + yy.slice(2) });
    });
    return {
      count: list.length,
      revenueCents: revenue,
      freightCents: freight,
      avgCents: list.length ? Math.round(revenue / list.length) : 0,
      fardos: fardos,
      displays: displays,
      series: series,
      seriesUnit: useDays ? 'dia' : 'mês',
      customers: Object.values(byCustomer).sort(desc),
      payments: Object.values(byPayment).sort(desc),
      items: Object.values(byItem).sort(desc),
      rows: rows,
    };
  }

  function toCsv(result) {
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['Pedido', 'Data', 'Cliente', 'Pagamento', 'Fardos', 'Expositores', 'Frete (R$)', 'Valor total (R$)'];
    const lines = result.rows.map((r) => [r.number, new Date(r.createdAt).toLocaleString('pt-BR'), r.customer, r.payment,
      r.fardos, r.displays, (r.freight / 100).toFixed(2).replace('.', ','), (r.cents / 100).toFixed(2).replace('.', ',')].map(esc).join(';'));
    return '﻿' + [head.map(esc).join(';')].concat(lines).join('\r\n');
  }

  // ---------- Rendering (browser only) ----------
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Single-series column chart in SVG with a hover tooltip.
  // width = real pixel width of the container, so text in the SVG keeps its size on any screen.
  function barChart(series, width) {
    if (!series.length) return '<p class="empty">Sem pedidos no período.</p>';
    const W = Math.max(280, Math.min(1000, Math.round(width || 640))), H = 200, padL = 4, padR = 4, padT = 22, padB = 26;
    const max = Math.max.apply(null, series.map((s) => s.cents)) || 1;
    const slot = (W - padL - padR) / series.length;
    const bw = Math.max(6, Math.min(48, slot - 6));
    const bars = series.map((s, i) => {
      const h = Math.max(2, (s.cents / max) * (H - padT - padB));
      const x = padL + i * slot + (slot - bw) / 2;
      const y = H - padB - h;
      const r = Math.min(4, bw / 2);
      // Rounded top, square base anchored on the baseline.
      const path = 'M' + x + ',' + (H - padB) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
        'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + r) + 'V' + (H - padB) + 'Z';
      const maxLabels = Math.max(3, Math.floor(W / 56));
      const showLabel = series.length <= maxLabels || i % Math.ceil(series.length / maxLabels) === 0;
      return '<g class="bar" data-tip="' + escHtml(s.label + ': ' + C.formatBRL(s.cents) + ' · ' + s.orders + (s.orders === 1 ? ' pedido' : ' pedidos')) + '">' +
        '<rect x="' + (padL + i * slot) + '" y="' + padT + '" width="' + slot + '" height="' + (H - padT - padB) + '" fill="transparent"/>' +
        '<path d="' + path + '"/>' +
        (showLabel ? '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + escHtml(s.label) + '</text>' : '') +
        '</g>';
    }).join('');
    const maxLabel = '<text class="max" x="' + padL + '" y="12">máx. ' + escHtml(C.formatBRL(max)) + '</text>';
    return '<div class="chart-wrap"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Faturamento por período">' +
      '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '" class="baseline"/>' +
      maxLabel + bars + '</svg><div class="chart-tip" hidden></div></div>';
  }

  // Ranked list with a thin inline bar (single hue, magnitude only).
  function rankTable(items, cols, limit) {
    if (!items.length) return '<p class="empty">Nada no período.</p>';
    const max = items[0].cents || 1;
    const rows = items.slice(0, limit || 10).map((it, i) =>
      '<tr><td class="rank">' + (i + 1) + '</td><td><div class="rk-name">' + escHtml(it.name) + '</div>' +
      '<div class="rk-bar"><span style="width:' + Math.max(2, Math.round(it.cents / max * 100)) + '%"></span></div></td>' +
      cols.map((c) => '<td class="num">' + c.value(it) + '</td>').join('') + '</tr>').join('');
    return '<table class="rk"><thead><tr><th></th><th></th>' + cols.map((c) => '<th class="num">' + c.label + '</th>').join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table>' + (items.length > (limit || 10) ? '<p class="hint">+ ' + (items.length - (limit || 10)) + ' outros</p>' : '');
  }

  function render(el, r) {
    const chartWidth = (el.clientWidth || 640) - 28; // card padding
    const kpi = (label, value) => '<div class="kpi"><span>' + label + '</span><strong>' + value + '</strong></div>';
    el.innerHTML =
      '<div class="kpis">' +
        kpi('Pedidos', r.count) +
        kpi('Faturamento', C.formatBRL(r.revenueCents)) +
        kpi('Ticket médio', C.formatBRL(r.avgCents)) +
        kpi('Fardos', r.fardos.toLocaleString('pt-BR')) +
        kpi('Frete cobrado', C.formatBRL(r.freightCents)) +
        kpi('Expositores', r.displays) +
      '</div>' +
      '<section class="an-card"><h3>Faturamento por ' + r.seriesUnit + '</h3>' + barChart(r.series, chartWidth) + '</section>' +
      '<div class="an-grid">' +
        '<section class="an-card"><h3>Produtos e kits que mais venderam</h3>' + rankTable(r.items, [
          { label: 'Fardos', value: (it) => it.fardos },
          { label: 'Valor', value: (it) => C.formatBRL(it.cents) }], 10) + '</section>' +
        '<section class="an-card"><h3>Clientes</h3>' + rankTable(r.customers, [
          { label: 'Pedidos', value: (it) => it.orders },
          { label: 'Valor', value: (it) => C.formatBRL(it.cents) }], 10) + '</section>' +
        '<section class="an-card"><h3>Pagamento</h3>' + rankTable(r.payments, [
          { label: 'Pedidos', value: (it) => it.orders },
          { label: 'Valor', value: (it) => C.formatBRL(it.cents) }], 8) + '</section>' +
      '</div>' +
      '<section class="an-card"><h3>Todos os pedidos (' + r.count + ')</h3>' +
        (r.rows.length ? '<div class="an-scroll"><table class="orders"><thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Pagamento</th><th class="num">Fardos</th><th class="num">Valor</th><th></th></tr></thead><tbody>' +
          r.rows.map((o) => '<tr data-number="' + escHtml(o.number) + '"><td>' + escHtml(o.number) + '</td><td>' + new Date(o.createdAt).toLocaleDateString('pt-BR') + '</td>' +
            '<td>' + escHtml(o.customer) + '</td><td>' + escHtml(o.payment) + '</td><td class="num">' + o.fardos + (o.displays ? ' <span class="muted">+' + o.displays + ' exp.</span>' : '') + '</td>' +
            '<td class="num"><strong>' + C.formatBRL(o.cents) + '</strong></td><td><button class="btn small" type="button" data-an-pdf>PDF</button></td></tr>').join('') +
          '</tbody><tfoot><tr><td colspan="4">Total</td><td class="num">' + r.fardos + '</td><td class="num"><strong>' + C.formatBRL(r.revenueCents) + '</strong></td><td></td></tr></tfoot></table></div>'
          : '<p class="empty">Nenhum pedido no período.</p>') +
      '</section>';

    // Hover / tap tooltip for the chart
    const wrap = el.querySelector('.chart-wrap');
    if (wrap) {
      const tip = wrap.querySelector('.chart-tip');
      const show = (e) => {
        const g = e.target.closest('.bar'); if (!g) { tip.hidden = true; return; }
        el.querySelectorAll('.bar.on').forEach((b) => b.classList.remove('on'));
        g.classList.add('on');
        tip.textContent = g.dataset.tip; tip.hidden = false;
        const wr = wrap.getBoundingClientRect(), br = g.getBoundingClientRect();
        tip.style.left = Math.min(Math.max(0, br.left - wr.left + br.width / 2 - 80), wr.width - 160) + 'px';
      };
      wrap.addEventListener('mousemove', show);
      wrap.addEventListener('click', show);
      wrap.addEventListener('mouseleave', () => { tip.hidden = true; el.querySelectorAll('.bar.on').forEach((b) => b.classList.remove('on')); });
    }
  }

  return { compute, toCsv, render, periodRange };
});
