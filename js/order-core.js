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
          fardosPerUnit: type === 'kit' ? item.fardos : type === 'display' ? 0 : 1,
        };
      });
    };
    catalog.products.forEach((p) => add('product', p));
    catalog.kits.forEach((k) => add('kit', k));
    // Display stands: one line per type, quantity in units, no price and no fardos.
    (catalog.displays || []).forEach((d) => add('display', { id: d.id, name: d.name, variants: [{ size: 'un', price: 0 }] }));
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
    // Products first, then kits, then display stands; alphabetical by name, then by size.
    const sizeOrder = (s) => parseInt(s, 10) || 0;
    const typeOrder = { product: 0, kit: 1, display: 2 };
    lines.sort((a, b) =>
      (typeOrder[a.type] - typeOrder[b.type]) ||
      a.name.localeCompare(b.name, 'pt-BR') ||
      sizeOrder(a.size) - sizeOrder(b.size));
    const totalCents = lines.reduce((s, l) => s + l.subtotalCents, 0);
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);
    const totalFardos = lines.reduce((s, l) => s + l.fardos, 0);
    const totalDisplays = lines.filter((l) => l.type === 'display').reduce((s, l) => s + l.qty, 0);
    const saleLines = lines.filter((l) => l.type !== 'display').length;
    return {
      lines: lines,
      totalCents: totalCents,
      totalQty: totalQty,
      totalFardos: totalFardos,
      totalDisplays: totalDisplays,
      saleLines: saleLines,
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

  // Standard payment terms offered on the order (days after delivery/billing).
  const PAYMENT_TERMS = [
    'À vista',
    '7 dias', '14 dias', '21 dias', '28 dias', '35 dias',
    '7/14 dias', '14/21 dias', '14/28 dias', '21/28 dias', '28/35 dias',
    '7/14/21 dias', '14/21/28 dias', '20/27/34 dias', '21/28/35 dias', '28/35/42 dias',
    '20/27/34/41 dias',
    'Outro (ver observações)',
  ];
  const PAYMENT_METHODS = ['Pix', 'Boleto', 'Cartão de crédito', 'A combinar'];

  return {
    PAYMENT_TERMS, PAYMENT_METHODS,
    toCents, formatBRL, buildIndex, lineKey, sanitizeQty,
    setQty, increment, decrement, removeLine, summarize, cleanCart, nextOrderNumber,
  };
});
