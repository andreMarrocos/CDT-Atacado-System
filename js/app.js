/*
 * CDT Atacado System - UI controller.
 * State lives in memory and is mirrored to localStorage (draft + saved orders).
 */
(function () {
  'use strict';
  const C = window.OrderCore;
  const P = window.OrderPdf;
  const CATALOG = window.CDT_CATALOG;
  const INDEX = C.buildIndex(CATALOG);
  const DRAFT_KEY = 'cdt-atacado.draft.v1';
  const ORDERS_KEY = 'cdt-atacado.orders.v1';

  const prodById = {};
  CATALOG.products.forEach((p) => { prodById[p.id] = p; });
  const kitById = {};
  CATALOG.kits.forEach((k) => { kitById[k.id] = k; });

  // ---------- Storage helpers (storage can be unavailable, so always guard) ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  // ---------- Platform adapter ----------
  // When published as a claude.ai artifact, window.claude.use() gives access to a
  // cloud database (orders survive across devices) and a download capability.
  // Opened as a normal file/website, everything falls back to localStorage + <a download>.
  const Cloud = { db: null, uid: null, downloads: null, ready: false, writing: {} };

  function orderDocId(number) { return 'order_' + String(number).replace(/[^A-Za-z0-9_\-]/g, '_'); }
  function userCol() { return Cloud.db.collection('data/users/' + Cloud.uid); }

  // Serialize writes per document (the store requires one write at a time per doc).
  function cloudWrite(docId, fn) {
    if (!Cloud.ready) return Promise.resolve();
    const prev = Cloud.writing[docId] || Promise.resolve();
    const next = prev.then(fn).catch((e) => {
      console.warn('cloud write failed', e);
      if (e && e.code === 'quota_exceeded') toast('Espaço na nuvem cheio: exclua pedidos antigos.');
    });
    Cloud.writing[docId] = next;
    return next;
  }
  function cloudSaveOrder(o) { return cloudWrite(orderDocId(o.number), () => userCol().doc(orderDocId(o.number)).set(JSON.parse(JSON.stringify(o)))); }
  function cloudDeleteOrder(number) { return cloudWrite(orderDocId(number), () => userCol().doc(orderDocId(number)).delete()); }
  let draftTimer;
  function cloudSaveDraft() {
    if (!Cloud.ready) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const body = JSON.parse(JSON.stringify({ cart: state.cart, customer: state.customer, editingNumber: state.editingNumber || null, savedAt: new Date().toISOString() }));
      cloudWrite('draft', () => userCol().doc('draft').set(body));
    }, 1200);
  }

  async function initCloud() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    try {
      const [db, user, downloads] = await Promise.all([
        window.claude.use('db'), window.claude.use('user'), window.claude.use('downloads')]);
      Cloud.downloads = downloads || null;
      const uid = db && user ? await user.id() : null;
      if (!db || !uid) { setStorageLabel(); return; }
      Cloud.db = db; Cloud.uid = uid;
      const snap = await Promise.race([
        userCol().get(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
      ]);
      const remote = {};
      let remoteDraft = null;
      snap.docs.forEach((d) => {
        if (!d.exists) return;
        if (d.id === 'draft') remoteDraft = d.data();
        else if (d.id.indexOf('order_') === 0) { const o = d.data(); if (o && o.number) remote[o.number] = o; }
      });
      Cloud.ready = true;
      // Merge: union by order number, newest edit wins; push local-only orders up.
      const stamp = (o) => String(o.updatedAt || o.createdAt || '');
      const merged = Object.assign({}, remote);
      state.orders.forEach((o) => {
        const r = merged[o.number];
        if (!r || stamp(o) > stamp(r)) { merged[o.number] = o; cloudSaveOrder(o); }
      });
      state.orders = Object.values(merged).map((o) => JSON.parse(JSON.stringify(o)))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      save(ORDERS_KEY, state.orders);
      if (!Object.keys(state.cart).length && remoteDraft && remoteDraft.cart && Object.keys(remoteDraft.cart).length) {
        state.cart = C.cleanCart(remoteDraft.cart, INDEX);
        state.customer = Object.assign({}, remoteDraft.customer || {});
        state.editingNumber = remoteDraft.editingNumber || null;
        save(DRAFT_KEY, { cart: state.cart, customer: state.customer, editingNumber: state.editingNumber });
        renderList();
      }
      updateTotals();
      if (!$('#history').hidden) renderHistory();
    } catch (e) {
      console.warn('cloud init failed', e);
      Cloud.ready = false;
    }
    setStorageLabel();
  }

  function setStorageLabel() {
    const el = $('#storage-label');
    if (!el) return;
    el.textContent = Cloud.ready
      ? '☁️ Pedidos salvos na sua conta (acessíveis em qualquer aparelho em que você abrir esta página).'
      : '💾 Pedidos salvos neste navegador. Use “Exportar backup” de vez em quando para guardar uma cópia (.json) e “Importar” para restaurar em outro aparelho.';
  }

  // Offer a generated file: platform download (artifact) or a regular <a download>.
  async function offerFile(filename, blob) {
    if (Cloud.downloads) {
      try { await Cloud.downloads.save({ filename: filename, data: blob }); return true; } catch (e) {
        if (e && e.code === 'declined') return false;
        if (e && e.code === 'rate_limited') { toast('Aguarde um instante e tente de novo.'); return false; }
        console.warn('downloads.save failed, falling back', e);
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  }

  // ---------- State ----------
  const draft = load(DRAFT_KEY, {});
  const state = {
    cart: C.cleanCart(draft.cart, INDEX),
    customer: draft.customer || {},
    editingNumber: draft.editingNumber || null,
    orders: load(ORDERS_KEY, []),
    tab: 'product',
    category: 'Todos',
    query: '',
    lastOrder: null,
  };
  function persistDraft() {
    save(DRAFT_KEY, { cart: state.cart, customer: state.customer, editingNumber: state.editingNumber });
    cloudSaveDraft();
  }
  // Save the order list locally and, when available, the changed order in the cloud.
  function persistOrders(changedOrder, deletedNumber) {
    const okLocal = save(ORDERS_KEY, state.orders);
    if (changedOrder) cloudSaveOrder(changedOrder);
    if (deletedNumber) cloudDeleteOrder(deletedNumber);
    if (!okLocal && !Cloud.ready) toast('Não foi possível salvar no navegador. Exporte um backup!');
  }

  // ---------- DOM helpers ----------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- Catalog list ----------
  const CATEGORIES = ['Todos'].concat(Array.from(new Set(CATALOG.products.map((p) => p.category))));

  function renderChips() {
    const chips = $('#chips');
    if (state.tab !== 'product') { chips.innerHTML = ''; return; }
    chips.innerHTML = CATEGORIES.map((c) => {
      const n = c === 'Todos' ? CATALOG.products.length : CATALOG.products.filter((p) => p.category === c).length;
      return '<button type="button" class="chip' + (c === state.category ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + ' <span class="muted">' + n + '</span></button>';
    }).join('');
  }

  function stepperHtml(key) {
    const q = state.cart[key] || 0;
    return '<div class="stepper" data-key="' + esc(key) + '">' +
      '<button type="button" class="minus" data-act="dec" aria-label="Diminuir"' + (q === 0 ? ' disabled' : '') + '>−</button>' +
      '<input type="number" inputmode="numeric" min="0" step="1" value="' + q + '" aria-label="Quantidade de fardos" data-act="set">' +
      '<button type="button" class="plus" data-act="inc" aria-label="Adicionar">+</button></div>';
  }

  function variantsHtml(type, item) {
    return item.variants.map((v) => {
      const key = C.lineKey(type, item.id, v.size);
      return '<div class="variant' + (state.cart[key] ? ' active' : '') + '" data-vkey="' + esc(key) + '">' +
        '<span class="size">' + esc(v.size) + '</span>' +
        '<span class="price">' + C.formatBRL(C.toCents(v.price)) + '</span>' +
        stepperHtml(key) + '</div>';
    }).join('');
  }

  function productCard(p) {
    return '<article class="card" data-item="product:' + p.id + '">' +
      '<img loading="lazy" src="' + esc(p.image) + '" alt="' + esc(p.name) + '">' +
      '<div><span class="code">#' + p.code + ' · ' + esc(p.category) + '</span>' +
      '<h3>' + esc(p.name) + '</h3><p class="use">' + esc(p.use) + '</p>' +
      variantsHtml('product', p) + '<div class="card-sub"></div></div></article>';
  }

  function kitCard(k) {
    const names = k.items.map((id) => prodById[id].name);
    return '<article class="card" data-item="kit:' + k.id + '">' +
      '<img loading="lazy" src="' + esc(k.image) + '" alt="' + esc(k.name) + '">' +
      '<div><span class="code">' + k.fardos + ' fardos · ' + (k.fardos * 10) + ' pacotes</span>' +
      '<h3>' + esc(k.name) + '</h3><p class="use">' + esc(k.description) + ' Um fardo de cada sabor.</p>' +
      '<details class="kit-items"><summary>Ver os ' + k.fardos + ' sabores</summary>' + names.map(esc).join(' · ') + '</details>' +
      variantsHtml('kit', k) + '<div class="card-sub"></div></div></article>';
  }

  function matches(item, extra) {
    if (!state.query) return true;
    const hay = norm([item.name, item.use || '', item.description || '', item.category || '', item.code || '', extra || '',
      item.variants.map((v) => v.size).join(' ')].join(' '));
    return norm(state.query).split(/\s+/).filter(Boolean).every((t) => hay.indexOf(t) !== -1 || hay.replace(/\s/g, '').indexOf(t) !== -1);
  }

  function renderList() {
    let html = '';
    let count = 0;
    if (state.tab === 'product') {
      CATALOG.products.forEach((p) => {
        if (state.category !== 'Todos' && p.category !== state.category) return;
        if (!matches(p)) return;
        html += productCard(p); count++;
      });
    } else if (state.tab === 'kit') {
      CATALOG.kits.forEach((k) => {
        if (!matches(k, k.items.map((id) => prodById[id].name).join(' '))) return;
        html += kitCard(k); count++;
      });
    } else {
      // "No pedido": show only items already in the cart
      const ids = new Set(Object.keys(state.cart).map((k) => k.split('|')[0]));
      CATALOG.products.forEach((p) => { if (ids.has('product:' + p.id) && matches(p)) { html += productCard(p); count++; } });
      CATALOG.kits.forEach((k) => { if (ids.has('kit:' + k.id) && matches(k)) { html += kitCard(k); count++; } });
    }
    $('#list').innerHTML = html;
    $('#empty').hidden = count > 0;
    $('#empty').textContent = state.tab === 'selected' ? 'Nenhum item no pedido ainda. Use o botão + nos produtos.' : 'Nenhum item encontrado.';
    $$('.card').forEach(updateCard);
  }

  // Refresh one card's steppers and subtotal without re-rendering (keeps input focus).
  function updateCard(card) {
    let sub = 0, fardos = 0;
    $$('.variant', card).forEach((row) => {
      const key = row.dataset.vkey;
      const q = state.cart[key] || 0;
      row.classList.toggle('active', q > 0);
      const input = $('input', row);
      if (document.activeElement !== input) input.value = q;
      $('.minus', row).disabled = q === 0;
      sub += q * INDEX[key].unitCents;
      fardos += q * INDEX[key].fardosPerUnit;
    });
    card.classList.toggle('has-qty', sub > 0);
    $('.card-sub', card).textContent = sub > 0 ? fardos + ' fardo(s) · ' + C.formatBRL(sub) : '';
  }

  function updateTotals() {
    const s = C.summarize(state.cart, INDEX);
    $('#bar-fardos').textContent = s.totalFardos;
    $('#bar-lines').textContent = s.lines.length;
    $('#bar-total').textContent = C.formatBRL(s.totalCents);
    $('#count-selected').textContent = s.lines.length;
    $('#btn-review').disabled = s.lines.length === 0;
    $('#history-count').textContent = state.orders.length;
    const badge = $('#editing-badge');
    badge.hidden = !state.editingNumber;
    badge.textContent = state.editingNumber ? 'Editando ' + state.editingNumber : '';
    return s;
  }

  function changeQty(key, action, value) {
    if (action === 'inc') state.cart = C.increment(state.cart, key, INDEX);
    else if (action === 'dec') state.cart = C.decrement(state.cart, key, INDEX);
    else state.cart = C.setQty(state.cart, key, value, INDEX);
    persistDraft();
    const itemKey = key.split('|')[0];
    $$('.card[data-item="' + itemKey + '"]').forEach(updateCard);
    updateTotals();
    if (!$('#review').hidden) renderReview();
  }

  // ---------- Review drawer ----------
  function imageFor(line) {
    return line.type === 'kit' ? kitById[line.id].image : prodById[line.id].image;
  }

  function renderReview() {
    const s = C.summarize(state.cart, INDEX);
    $('#review-lines').innerHTML = s.lines.length ? s.lines.map((l) =>
      '<div class="rline">' +
        '<img src="' + esc(imageFor(l)) + '" alt="">' +
        '<div><div class="rname">' + esc(l.name) + ' · ' + esc(l.size) + '</div>' +
        '<div class="rmeta">' + (l.type === 'kit' ? 'Kit · ' + l.fardosPerUnit + ' fardos cada · ' : '#' + l.code + ' · ') +
          C.formatBRL(l.unitCents) + ' × ' + l.qty + '</div>' +
        '<div class="rsub">' + C.formatBRL(l.subtotalCents) + '</div></div>' +
        '<div class="ractions">' + stepperHtml(l.key) +
          '<button type="button" class="remove" data-remove="' + esc(l.key) + '">Remover</button></div>' +
      '</div>').join('') : '<p class="empty">Pedido vazio.</p>';
    $('#review-totals').innerHTML =
      '<div><span>Itens (linhas)</span><span>' + s.lines.length + '</span></div>' +
      '<div><span>Total de fardos</span><span>' + s.totalFardos + '</span></div>' +
      '<div><span>Total de pacotes (10 por fardo)</span><span>' + s.totalUnits + '</span></div>' +
      '<div class="grand"><span>TOTAL</span><span>' + C.formatBRL(s.totalCents) + '</span></div>';
    $('#btn-finish').disabled = s.lines.length === 0;
    $('#btn-finish').textContent = state.editingNumber ? 'Salvar alterações e gerar PDF' : 'Finalizar e gerar PDF';
  }

  function fillCustomerForm() {
    const f = $('#customer-form');
    Array.from(f.elements).forEach((el) => { if (el.name) el.value = state.customer[el.name] || ''; });
  }

  function readCustomerForm() {
    const f = $('#customer-form');
    const c = {};
    Array.from(f.elements).forEach((el) => { if (el.name) c[el.name] = el.value.trim(); });
    return c;
  }

  function open(id) { $('#' + id).hidden = false; document.body.style.overflow = 'hidden'; }
  function close(id) { $('#' + id).hidden = true; if ($$('.overlay').every((o) => o.hidden)) document.body.style.overflow = ''; }

  // ---------- Finish / PDF ----------
  function finishOrder() {
    state.customer = readCustomerForm();
    persistDraft();
    if (!state.customer.store) {
      const inp = $('#customer-form [name=store]');
      inp.classList.add('touched'); $('#customer-box').open = true; inp.focus();
      toast('Informe o nome da loja / cliente.');
      return;
    }
    const s = C.summarize(state.cart, INDEX);
    if (!s.lines.length) { toast('O pedido está vazio.'); return; }

    const now = new Date().toISOString();
    let order;
    if (state.editingNumber) {
      const i = state.orders.findIndex((o) => o.number === state.editingNumber);
      const prev = i >= 0 ? state.orders[i] : {};
      order = { number: state.editingNumber, createdAt: prev.createdAt || now, updatedAt: now,
        customer: state.customer, cart: Object.assign({}, state.cart), totalCents: s.totalCents, totalFardos: s.totalFardos };
      if (i >= 0) state.orders[i] = order; else state.orders.unshift(order);
    } else {
      order = { number: C.nextOrderNumber(state.orders.map((o) => o.number)), createdAt: now,
        customer: state.customer, cart: Object.assign({}, state.cart), totalCents: s.totalCents, totalFardos: s.totalFardos };
      state.orders.unshift(order);
    }
    persistOrders(order);
    state.lastOrder = order;
    // Further changes to this cart update the same saved order instead of duplicating it.
    state.editingNumber = order.number;
    persistDraft();
    close('review');
    $('#done-body').innerHTML =
      '<p><strong>' + esc(order.number) + '</strong> · ' + esc(order.customer.store) + '</p>' +
      '<p>' + s.lines.length + ' itens · ' + s.totalFardos + ' fardos · <strong>' + C.formatBRL(s.totalCents) + '</strong></p>' +
      '<p class="hint">O pedido ficou salvo em “Pedidos salvos”. O PDF foi baixado; você também pode compartilhar direto pelo WhatsApp.</p>';
    open('done');
    downloadPdf(order);
    updateTotals();
  }

  function downloadPdf(order) {
    try {
      const doc = P.buildOrderPdf(order, CATALOG);
      return offerFile(P.pdfFileName(order), doc.output('blob'));
    } catch (e) {
      console.error(e); toast('Erro ao gerar PDF: ' + e.message);
      return Promise.resolve(false);
    }
  }

  async function sharePdf(order) {
    try {
      const doc = P.buildOrderPdf(order, CATALOG);
      const blob = doc.output('blob');
      const file = new File([blob], P.pdfFileName(order), { type: 'application/pdf' });
      if (!Cloud.downloads && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Pedido ' + order.number,
          text: 'Pedido ' + order.number + ' · ' + (order.customer.store || '') + ' · ' + C.formatBRL(order.totalCents) });
      } else {
        // In the Claude app the download prompt opens the phone's share sheet.
        const ok = await offerFile(P.pdfFileName(order), blob);
        if (ok && !Cloud.downloads) toast('Compartilhamento direto não suportado aqui; o PDF foi baixado.');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.error(e); toast('Não foi possível compartilhar: ' + e.message);
    }
  }

  function newOrder() {
    state.cart = {}; state.customer = {}; state.editingNumber = null;
    persistDraft(); fillCustomerForm(); renderList(); updateTotals();
  }

  // ---------- History ----------
  function renderHistory() {
    const list = $('#history-list');
    if (!state.orders.length) { list.innerHTML = '<p class="empty">Nenhum pedido salvo ainda.</p>'; return; }
    list.innerHTML = state.orders.map((o) => {
      const s = C.summarize(o.cart, INDEX);
      return '<div class="hline" data-number="' + esc(o.number) + '">' +
        '<div class="htop"><span>' + esc(o.number) + ' · ' + esc(o.customer.store || 'Sem nome') + '</span><span>' + C.formatBRL(s.totalCents) + '</span></div>' +
        '<div class="hmeta">' + new Date(o.createdAt).toLocaleString('pt-BR') + (o.updatedAt ? ' · editado ' + new Date(o.updatedAt).toLocaleString('pt-BR') : '') +
          ' · ' + s.lines.length + ' itens · ' + s.totalFardos + ' fardos' + (o.customer.city ? ' · ' + esc(o.customer.city) : '') + '</div>' +
        '<div class="hactions">' +
          '<button class="btn" data-h="pdf" type="button">PDF</button>' +
          '<button class="btn" data-h="share" type="button">Compartilhar</button>' +
          '<button class="btn" data-h="edit" type="button">Editar</button>' +
          '<button class="btn" data-h="copy" type="button">Duplicar</button>' +
          '<button class="btn danger ghost" data-h="del" type="button">Excluir</button>' +
        '</div></div>';
    }).join('');
  }

  function hasDraft() { return Object.keys(state.cart).length > 0; }

  async function historyAction(number, act) {
    const o = state.orders.find((x) => x.number === number);
    if (!o) return;
    if (act === 'pdf') downloadPdf(o);
    else if (act === 'share') sharePdf(o);
    else if (act === 'edit' || act === 'copy') {
      if (hasDraft() && !(await confirmSafe('Substituir o pedido em andamento pelo pedido ' + number + '?', 'Substituir'))) return;
      state.cart = C.cleanCart(o.cart, INDEX);
      state.customer = Object.assign({}, o.customer);
      state.editingNumber = act === 'edit' ? o.number : null;
      persistDraft(); fillCustomerForm(); renderList(); updateTotals();
      close('history');
      toast(act === 'edit' ? 'Editando ' + number : 'Pedido duplicado como novo');
    } else if (act === 'del') {
      if (!(await confirmSafe('Excluir o pedido ' + number + '? Essa ação não pode ser desfeita.', 'Excluir'))) return;
      state.orders = state.orders.filter((x) => x.number !== number);
      if (state.editingNumber === number) state.editingNumber = null;
      persistOrders(null, number); persistDraft(); renderHistory(); updateTotals();
    }
  }

  // In-page confirmation dialog (window.confirm is blocked inside embedded pages).
  function confirmSafe(msg, okLabel) {
    return new Promise((resolve) => {
      const box = $('#confirm');
      $('#confirm-msg').textContent = msg;
      $('#confirm-ok').textContent = okLabel || 'Confirmar';
      const done = (v) => { box.hidden = true; $('#confirm-ok').onclick = null; $('#confirm-cancel').onclick = null; resolve(v); };
      $('#confirm-ok').onclick = () => done(true);
      $('#confirm-cancel').onclick = () => done(false);
      box.hidden = false;
      $('#confirm-ok').focus();
    });
  }

  function exportBackup() {
    const data = { app: 'CDT Atacado System', exportedAt: new Date().toISOString(), orders: state.orders,
      draft: { cart: state.cart, customer: state.customer, editingNumber: state.editingNumber } };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    offerFile('cdt-atacado-backup-' + new Date().toISOString().slice(0, 10) + '.json', blob);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const incoming = Array.isArray(data) ? data : data.orders;
        if (!Array.isArray(incoming)) throw new Error('arquivo inválido');
        const known = new Set(state.orders.map((o) => o.number));
        let added = 0;
        incoming.forEach((o) => {
          if (o && o.number && o.cart && !known.has(o.number)) { state.orders.push(o); known.add(o.number); added++; cloudSaveOrder(o); }
        });
        state.orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        persistOrders(); renderHistory(); updateTotals();
        toast(added + ' pedido(s) importado(s).');
      } catch (e) { toast('Não foi possível importar: ' + e.message); }
    };
    reader.readAsText(file);
  }

  // ---------- Events ----------
  function bind() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      state.tab = t.dataset.tab;
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      renderChips(); renderList(); window.scrollTo({ top: 0 });
    }));
    $('#chips').addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      state.category = b.dataset.cat; renderChips(); renderList();
    });
    let qTimer;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.query = e.target.value.trim(); renderList(); }, 120);
    });

    // Stepper clicks (catalog list and review drawer)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.stepper button');
      if (btn) { changeQty(btn.closest('.stepper').dataset.key, btn.dataset.act); return; }
      const rm = e.target.closest('[data-remove]');
      if (rm) { state.cart = C.removeLine(state.cart, rm.dataset.remove); persistDraft(); renderReview(); renderList(); updateTotals(); return; }
      const h = e.target.closest('[data-h]');
      if (h) { historyAction(h.closest('.hline').dataset.number, h.dataset.h); return; }
      if (e.target.closest('[data-close]')) { close(e.target.closest('.overlay').id); return; }
      if (e.target.classList.contains('overlay')) close(e.target.id);
    });
    // Typed quantities
    document.addEventListener('change', (e) => {
      if (e.target.matches('.stepper input')) changeQty(e.target.closest('.stepper').dataset.key, 'set', e.target.value);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('.stepper input')) e.target.blur();
      if (e.key === 'Escape') {
        if (!$('#confirm').hidden) { $('#confirm-cancel').click(); return; }
        $$('.overlay').forEach((o) => { if (!o.hidden) close(o.id); });
      }
    });
    document.addEventListener('focusin', (e) => { if (e.target.matches('.stepper input')) e.target.select(); });

    $('#btn-review').addEventListener('click', () => { fillCustomerForm(); renderReview(); open('review'); });
    $('#customer-form').addEventListener('input', () => { state.customer = readCustomerForm(); persistDraft(); });
    $('#btn-clear').addEventListener('click', async () => {
      if (!(await confirmSafe('Limpar todos os itens do pedido atual?', 'Limpar'))) return;
      state.cart = {}; state.editingNumber = null; persistDraft(); renderReview(); renderList(); updateTotals();
    });
    $('#btn-finish').addEventListener('click', finishOrder);
    $('#btn-done-download').addEventListener('click', () => state.lastOrder && downloadPdf(state.lastOrder));
    $('#btn-done-share').addEventListener('click', () => state.lastOrder && sharePdf(state.lastOrder));
    $('#btn-new-order').addEventListener('click', () => { newOrder(); close('done'); toast('Novo pedido iniciado.'); });
    $('#btn-history').addEventListener('click', () => { renderHistory(); open('history'); });
    $('#btn-export').addEventListener('click', exportBackup);
    $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  }

  // ---------- Init ----------
  $('#count-products').textContent = CATALOG.products.length;
  $('#count-kits').textContent = CATALOG.kits.length;
  bind();
  renderChips();
  renderList();
  updateTotals();
  setStorageLabel();
  initCloud();

  // Expose for automated tests / debugging.
  window.CDTApp = { state, INDEX, Cloud, summarize: () => C.summarize(state.cart, INDEX) };
})();
