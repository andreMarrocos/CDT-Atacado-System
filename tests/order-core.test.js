// Unit tests for the order logic and the catalog data. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../js/order-core.js');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8'));
const index = C.buildIndex(catalog);

test('catalog has every product and kit from the PDF', () => {
  assert.equal(catalog.products.length, 147);
  assert.equal(catalog.kits.length, 12);
  const variants = catalog.products.reduce((s, p) => s + p.variants.length, 0);
  assert.equal(variants, 408);
  catalog.products.forEach((p) => {
    assert.ok(p.variants.length > 0, p.name + ' has no prices');
    assert.ok(fs.existsSync(path.join(__dirname, '..', p.image)), 'missing image for ' + p.name);
    p.variants.forEach((v) => assert.ok(v.price > 0));
  });
});

test('spot-check prices against the catalog', () => {
  const price = (name, size) => catalog.products.find((p) => p.name === name).variants.find((v) => v.size === size).price;
  assert.equal(price('Açafrão Cúrcuma - Puro', '30 g'), 51.0);
  assert.equal(price('Açafrão Cúrcuma - Puro', '100 g'), 126.0);
  assert.equal(price('Chimichurri Defumado', '100 g'), 274.5);
  assert.equal(price('Noz Moscada Grão', '100 g'), 285.75);
  assert.equal(price('Farinha de Tapioca em Flocos', '250 g'), 112.5);
  assert.equal(price('Sal fino com Colorau', '250 g'), 127.5);
  assert.equal(price('Vinagrete', '50 g'), 96.0);
  // Sizes that are "-" in the catalog must not exist
  const sizes = (name) => catalog.products.find((p) => p.name === name).variants.map((v) => v.size);
  assert.deepEqual(sizes('Alho Poró'), ['30 g', '50 g']);
  assert.deepEqual(sizes('Beterraba em pó'), ['100 g']);
  assert.deepEqual(sizes('Folhas de Louro Selecionadas'), ['30 g']);
});

test('every kit price equals the sum of its products (validates price extraction)', () => {
  const byId = Object.fromEntries(catalog.products.map((p) => [p.id, p]));
  catalog.kits.forEach((k) => {
    assert.equal(k.items.length, k.fardos);
    k.variants.forEach((kv) => {
      const sum = k.items.reduce((s, id) => s + C.toCents(byId[id].variants.find((v) => v.size === kv.size).price), 0);
      assert.equal(sum, C.toCents(kv.price), k.name + ' ' + kv.size);
    });
  });
});

test('formatBRL', () => {
  assert.equal(C.formatBRL(0), 'R$ 0,00');
  assert.equal(C.formatBRL(3375), 'R$ 33,75');
  assert.equal(C.formatBRL(105600), 'R$ 1.056,00');
  assert.equal(C.formatBRL(123456789), 'R$ 1.234.567,89');
});

test('add, increment, decrement, set, remove and totals', () => {
  const a = C.lineKey('product', 'alecrim', '30 g');       // 33,75
  const b = C.lineKey('product', 'chimichurri-defumado', '100 g'); // 274,50
  const k = C.lineKey('kit', 'kit-peixaria', '50 g');      // 612,75, 8 fardos
  let cart = {};
  cart = C.increment(cart, a, index);
  cart = C.increment(cart, a, index);
  cart = C.increment(cart, a, index);
  cart = C.decrement(cart, a, index); // 2
  cart = C.setQty(cart, b, 3, index);
  cart = C.increment(cart, k, index);
  let s = C.summarize(cart, index);
  assert.equal(s.lines.length, 3);
  assert.equal(s.totalCents, 2 * 3375 + 3 * 27450 + 61275);
  assert.equal(s.totalFardos, 2 + 3 + 8);
  assert.equal(s.totalUnits, 130);
  // decrement to zero removes the line
  cart = C.decrement(cart, k, index);
  assert.equal(cart[k], undefined);
  // never goes negative
  cart = C.decrement(cart, k, index);
  assert.equal(cart[k], undefined);
  // invalid typed quantities
  cart = C.setQty(cart, a, '-5', index); assert.equal(cart[a], undefined);
  cart = C.setQty(cart, a, '2.9', index); assert.equal(cart[a], 2);
  cart = C.setQty(cart, a, 'abc', index); assert.equal(cart[a], undefined);
  cart = C.removeLine(cart, b);
  s = C.summarize(cart, index);
  assert.equal(s.totalCents, 0);
  assert.throws(() => C.increment({}, 'product:nope|30 g', index));
});

test('ordering every single variant once sums to the catalog total', () => {
  let cart = {};
  let expected = 0;
  Object.values(index).forEach((m) => { cart = C.increment(cart, m.key, index); expected += m.unitCents; });
  const s = C.summarize(cart, index);
  assert.equal(s.lines.length, Object.keys(index).length);
  assert.equal(s.totalCents, expected);
});

test('order numbers are sequential per day', () => {
  const d = new Date(2026, 10, 5);
  assert.equal(C.nextOrderNumber([], d), 'CDT-20261105-001');
  assert.equal(C.nextOrderNumber(['CDT-20261105-001', 'CDT-20261105-007', 'CDT-20261104-020'], d), 'CDT-20261105-008');
});

test('cleanCart drops unknown items', () => {
  const a = C.lineKey('product', 'alecrim', '30 g');
  assert.deepEqual(C.cleanCart({ [a]: 2, 'product:x|1 g': 5, [C.lineKey('product', 'alecrim', '50 g')]: 0 }, index), { [a]: 2 });
});

test('display stands are orderable with no price and no fardos', () => {
  require('../js/expositores.js');
  const cat = Object.assign({}, catalog, { displays: globalThis.CDT_EXPOSITORES });
  const idx = C.buildIndex(cat);
  assert.ok(cat.displays.length >= 10);
  let cart = {};
  cart = C.increment(cart, C.lineKey('display', 'expositor-gondola-1m', 'un'), idx);
  cart = C.increment(cart, C.lineKey('display', 'expositor-gondola-1m', 'un'), idx);
  cart = C.increment(cart, C.lineKey('product', 'alecrim', '30 g'), idx);
  const s = C.summarize(cart, idx);
  assert.equal(s.totalCents, 3375);
  assert.equal(s.totalFardos, 1);
  assert.equal(s.totalDisplays, 2);
  assert.equal(s.saleLines, 1);
  assert.equal(s.lines[s.lines.length - 1].type, 'display'); // displays listed last
  cat.displays.forEach((d) => assert.ok(globalThis.CDT_EXPOSITOR_ICONS[d.icon], 'icon for ' + d.id));
});

test('payment terms include à vista and 7-day steps', () => {
  assert.equal(C.PAYMENT_TERMS[0], 'À vista');
  ['7 dias', '14 dias', '21 dias', '28 dias', '35 dias', '20/27/34 dias'].forEach((t) => assert.ok(C.PAYMENT_TERMS.includes(t), t));
  assert.ok(C.PAYMENT_METHODS.includes('Pix') && C.PAYMENT_METHODS.includes('Boleto'));
});
