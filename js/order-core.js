/*
 * CDT Atacado System - order core logic.
 * Pure functions with no DOM access so they can be unit-tested in Node.
 * All money is handled in integer cents to avoid floating point errors.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrderCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Convert a price in reais (e.g. 33.75) to integer cents (3375).
  function toCents(value) {
    return Math.round(Number(value) * 100);
  }

  // Format integer cents as Brazilian currency, e.g. 123456 -> "R$ 1.234,56".
  function formatBRL(cents) {
    const negative = cents < 0;
    const abs = Math.abs(Math.round(cents));
    const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const centavos = String(abs % 100).padStart(2, '0');
    return (negative ? '-' : '') + 'R$ ' + reais + ',' + centavos;
  }

  // Build a lookup of every orderable line: "<type>:<id>|<size>" -> line metadata.
  function buildIndex(catalog) {
    const index = {};
    const add = (type, item) => {
      item.variants.forEach((v) => {
        const key = lineKey(type, item.id, v.size);
        if (index[key]) throw new Error('Duplicate catalog key: ' + key);
        index[key] = {
          key: key,
          type: type,
          id: item.id,
          code: item.code || '',
          name: item.name,
          size: v.size,
          unitCents: toCents(v.price),
          fardosPerUnit: type === 'kit' ? item.fardos : 1,
        };
      });
    };
    catalog.products.forEach((p) => add('product', p));
    catalog.kits.forEach((k) => add('kit', k));
    return index;
  }

  function lineKey(type, id, size) {
    return type + ':' + id + '|' + size;
  }

  // Quantities must be whole, non-negative numbers; anything else becomes 0.
  function sanitizeQty(qty) {
    const n = Math.floor(Number(qty));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, 9999);
  }

  // Cart is a plain object: { [lineKey]: quantity }. Functions return new objects.
  function setQty(cart, key, qty, index) {
    if (index && !index[key]) throw new Error('Unknown item: ' + key);
    const next = Object.assign({}, cart);
    const q = sanitizeQty(qty);
    if (q === 0) delete next[key];
    else next[key] = q;
    return next;
  }

  function increment(cart, key, index, step) {
    return setQty(cart, key, (cart[key] || 0) + (step || 1), index);
  }

  function decrement(cart, key, index, step) {
    return setQty(cart, key, (cart[key] || 0) - (step || 1), index);
  }

  function removeLine(cart, key) {
    const next = Object.assign({}, cart);
    delete next[key];
    return next;
  }

  // Expand the cart into ordered lines with subtotals, plus overall totals.
  function summarize(cart, index) {
    const lines = [];
    Object.keys(cart).forEach((key) => {
      const meta = index[key];
      const qty = sanitizeQty(cart[key]);
      if (!meta || qty === 0) return; // ignore stale or empty entries
      lines.push(Object.assign({}, meta, {
        qty: qty,
        subtotalCents: meta.unitCents * qty,
        fardos: meta.fardosPerUnit * qty,
      }));
    });
    // Products first, then kits; alphabetical by name, then by size.
    const sizeOrder = (s) => parseInt(s, 10) || 0;
    lines.sort((a, b) =>
      (a.type === b.type ? 0 : a.type === 'product' ? -1 : 1) ||
      a.name.localeCompare(b.name, 'pt-BR') ||
      sizeOrder(a.size) - sizeOrder(b.size));
    const totalCents = lines.reduce((s, l) => s + l.subtotalCents, 0);
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);
    const totalFardos = lines.reduce((s, l) => s + l.fardos, 0);
    return {
      lines: lines,
      totalCents: totalCents,
      totalQty: totalQty,
      totalFardos: totalFardos,
      totalUnits: totalFardos * 10, // each fardo holds 10 packages
    };
  }

  // Drop entries that no longer exist in the catalog (e.g. after a catalog update).
  function cleanCart(cart, index) {
    const next = {};
    Object.keys(cart || {}).forEach((k) => {
      const q = sanitizeQty(cart[k]);
      if (index[k] && q > 0) next[k] = q;
    });
    return next;
  }

  // Sequential order number based on date: CDT-YYYYMMDD-NNN.
  function nextOrderNumber(existingNumbers, date) {
    const d = date || new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const prefix = 'CDT-' + stamp + '-';
    let max = 0;
    (existingNumbers || []).forEach((n) => {
      if (typeof n === 'string' && n.indexOf(prefix) === 0) max = Math.max(max, parseInt(n.slice(prefix.length), 10) || 0);
    });
    return prefix + String(max + 1).padStart(3, '0');
  }

  return {
    toCents, formatBRL, buildIndex, lineKey, sanitizeQty,
    setQty, increment, decrement, removeLine, summarize, cleanCart, nextOrderNumber,
  };
});
