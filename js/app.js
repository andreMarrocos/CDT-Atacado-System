/*
 * CDT Atacado System - UI controller.
 * State lives in memory and is mirrored to localStorage (draft + saved orders).
 * Optional online storage: claude.ai artifact database, or a private GitHub repository.
 */
(function () {
  'use strict';
  const C = window.OrderCore;
  const P = window.OrderPdf;
  const CATALOG = window.CDT_CATALOG;
  CATALOG.displays = window.CDT_EXPOSITORES || [];
  const ICONS = window.CDT_EXPOSITOR_ICONS || {};
  const INDEX = C.buildIndex(CATALOG);
  const DRAFT_KEY = 'cdt-atacado.draft.v1';
  const ORDERS_KEY = 'cdt-atacado.orders.v1';
  const GH_KEY = 'cdt-atacado.github.v1';

  const prodById = {};
  CATALOG.products.forEach((p) => { prodById[p.id] = p; });
  const kitById = {};
  CATALOG.kits.forEach((k) => { kitById[k.id] = k; });
  const dispById = {};
  CATALOG.displays.forEach((d) => { dispById[d.id] = d; });

  // ---------- Storage helpers (storage can be unavailable, so always guard) ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function drop(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  // ---------- DOM helpers ----------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
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

  // ---------- Online storage ----------
  // Remote.kind: 'claude' (artifact database), 'github' (private repo) or null (this device only).
  const Remote = { kind: null, ready: false, db: null, uid: null, gh: null, downloads: null, writing: {}, lastError: '' };

  function orderDocId(number) { return 'order_' + String(number).replace(/[^A-Za-z0-9_\-]/g, '_'); }
  function userCol() { return Remote.db.collection('data/users/' + Remote.uid); }

  // Serialize writes per order (one write at a time per document/file).
  function remoteWrite(key, fn) {
    if (!Remote.ready) return Promise.resolve();
    const prev = Remote.writing[key] || Promise.resolve();
    const next = prev.then(fn).then(() => { Remote.lastError = ''; setStorageLabel(); }).catch((e) => {
      console.warn('remote write failed', e);
      Remote.lastError = e && e.message ? e.message : String(e);
      setStorageLabel();
      toast('Não foi possível salvar online agora. O pedido ficou salvo neste aparelho.');
    });
    Remote.writing[key] = next;
    return next;
  }
  function remoteSaveOrder(o) {
    const copy = JSON.parse(JSON.stringify(o));
    if (Remote.kind === 'claude') return remoteWrite(o.number, () => userCol().doc(orderDocId(o.number)).set(copy));
    if (Remote.kind === 'github') return remoteWrite(o.number, () => Remote.gh.saveOrder(copy));
    return Promise.resolve();
  }
  function remoteDeleteOrder(number) {
    if (Remote.kind === 'claude') return remoteWrite(number, () => userCol().doc(orderDocId(number)).delete());
    if (Remote.kind === 'github') return remoteWrite(number, () => Remote.gh.deleteOrder(number));
    return Promise.resolve();
  }
  let draftTimer;
  function remoteSaveDraft() {
    if (!Remote.ready || Remote.kind !== 'claude') return; // drafts sync only in the claude.ai version
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const body = JSON.parse(JSON.stringify({ cart: state.cart, customer: state.customer, editingNumber: state.editingNumber || null, savedAt: new Date().toISOString() }));
      remoteWrite('draft', () => userCol().doc('draft').set(body));
    }, 1200);
  }

  // Union of local and remote orders by number; the most recent edit wins; local-only ones are uploaded.
  function mergeRemoteOrders(remoteList) {
    const stamp = (o) => String(o.updatedAt || o.createdAt || '');
    const merged = {};
    remoteList.forEach((o) => { if (o && o.number) merged[o.number] = o; });
    state.orders.forEach((o) => {
      const r = merged[o.number];
      if (!r || stamp(o) > stamp(r)) { merged[o.number] = o; remoteSaveOrder(o); }
    });
    state.orders = Object.values(merged).map((o) => JSON.parse(JSON.stringify(o)))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    save(ORDERS_KEY, state.orders);
    updateTotals();
    if (!$('#history').hidden) renderHistory();
  }

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), ms))]);
  }

  async function initClaudeRuntime() {
    if (!window.claude || typeof window.claude.use !== 'function') return false;
    try {
      const [db, user, downloads] = await Promise.all([
        window.claude.use('db'), window.claude.use('user'), window.claude.use('downloads')]);
      Remote.downloads = downloads || null;
      const uid = db && user ? await user.id() : null;
      if (!db || !uid) return !!downloads;
      Remote.kind = 'claude'; Remote.db = db; Remote.uid = uid;
      const snap = await withTimeout(userCol().get(), 10000);
      const remote = [];
      let remoteDraft = null;
      snap.docs.forEach((d) => {
        if (!d.exists) return;
        if (d.id === 'draft') remoteDraft = d.data();
        else if (d.id.indexOf('order_') === 0) remote.push(d.data());
      });
      Remote.ready = true;
      mergeRemoteOrders(remote);
      if (!Object.keys(state.cart).length && remoteDraft && remoteDraft.cart && Object.keys(remoteDraft.cart).length) {
        state.cart = C.cleanCart(remoteDraft.cart, INDEX);
        state.customer = Object.assign({}, remoteDraft.customer || {});
        state.editingNumber = remoteDraft.editingNumber || null;
        save(DRAFT_KEY, { cart: state.cart, customer: state.customer, editingNumber: state.editingNumber });
        renderList(); updateTotals();
      }
      return true;
    } catch (e) {
      console.warn('claude runtime init failed', e);
      Remote.kind = null; Remote.ready = false;
      return !!Remote.downloads;
    }
  }

  async function connectGitHub(cfg, quiet) {
    try {
      const gh = window.GitHubSync.create(cfg);
      const info = await withTimeout(gh.test(), 15000);
      Remote.kind = 'github'; Remote.gh = gh; Remote.ready = true; Remote.lastError = '';
      Remote.ghPrivate = info.private;
      setStorageLabel();
      const list = await withTimeout(gh.listOrders(), 60000);
      mergeRemoteOrders(list);
      setStorageLabel();
      if (!quiet) toast('Conectado ao GitHub: ' + info.fullName + (info.private ? '' : ' (atenção: repositório público!)'));
      return true;
    } catch (e) {
      console.warn('github connect failed', e);
      if (Remote.kind === 'github') { Remote.kind = null; Remote.ready = false; Remote.gh = null; }
      Remote.lastError = e.message;
      setStorageLabel();
      if (!quiet) toast('Falha ao conectar: ' + e.message);
      return false;
    }
  }

  async function initRemote() {
    const inClaude = await initClaudeRuntime();
    if (!inClaude && Remote.kind !== 'claude') {
      const cfg = load(GH_KEY, null);
      if (cfg && cfg.repo && cfg.token) await connectGitHub(cfg, true);
    }
    setStorageLabel();
  }

  function setStorageLabel() {
    const el = $('#storage-label');
    const gh = $('#gh-box');
    const inClaude = Remote.kind === 'claude' || !!Remote.downloads;
    if (gh) gh.hidden = inClaude;
    const cfg = load(GH_KEY, {}) || {};
    if ($('#gh-repo') && !$('#gh-repo').value) $('#gh-repo').value = cfg.repo || '';
    let text;
    if (Remote.kind === 'claude' && Remote.ready) text = '☁️ Pedidos salvos na sua conta Claude: aparecem em qualquer aparelho em que você abrir esta página.';
    else if (Remote.kind === 'github' && Remote.ready) text = '☁️ Pedidos salvos online no GitHub (' + Remote.gh.repo + ') e neste aparelho.' + (Remote.ghPrivate === false ? ' ⚠️ O repositório é público: deixe-o privado.' : '');
    else text = '💾 Pedidos salvos só neste aparelho. Para salvar online, conecte o GitHub abaixo, ou use “Exportar backup”.';
    if (Remote.lastError) text += ' ⚠️ Último erro: ' + Remote.lastError;
    if (el) el.textContent = text;
    const badge = $('#cloud-badge');
    if (badge) { badge.textContent = Remote.ready ? '☁️' : '💾'; badge.title = text; }
    if ($('#gh-disconnect')) $('#gh-disconnect').hidden = !(cfg && cfg.token);
  }

  // Offer a generated file: platform download (claude.ai) or a regular <a download>.
  async function offerFile(filename, blob) {
    if (Remote.downloads) {
      try { await Remote.downloads.save({ filename: filename, data: blob }); return true; } catch (e) {
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

  function persistDraft() {
    save(DRAFT_KEY, { cart: state.cart, customer: state.customer, editingNumber: state.editingNumber });
    remoteSaveDraft();
  }
  // Save the order list locally and, when connected, the changed order online.
  function persistOrders(changedOrder, deletedNumber) {
    const okLocal = save(ORDERS_KEY, state.orders);
    if (changedOrder) remoteSaveOrder(changedOrder);
    if (deletedNumber) remoteDeleteOrder(deletedNumber);
    if (!okLocal && !Remote.ready) toast('Não foi possível salvar no navegador. Exporte um backup!');
  }

  // ---------- Catalog list ----------
  const CATEGORIES = ['Todos'].concat(Array.from(new Set(CATALOG.products.map((p) => p.category))));
  const DISPLAY_GROUPS = ['Todos'].concat(Array.from(new Set(CATALOG.displays.map((d) => d.group))));

  function renderChips() {
    const chips = $('#chips');
    let list = null, items = null, field = null;
    if (state.tab === 'product') { list = CATEGORIES; items = CATALOG.products; field = 'category'; }
    else if (state.tab === 'display') { list = DISPLAY_GROUPS; items = CATALOG.displays; field = 'group'; }
    if (!list) { chips.innerHTML = ''; return; }
    chips.innerHTML = list.map((c) => {
      const n = c === 'Todos' ? items.length : items.filter((p) => p[field] === c).length;
      return '<button type="button" class="chip' + (c === state.category ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + ' <span class="muted">' + n + '</span></button>';
    }).join('');
  }

  function stepperHtml(key) {
    const q = state.cart[key] || 0;
    return '<div class="stepper" data-key="' + esc(key) + '">' +
      '<button type="button" class="minus" data-act="dec" aria-label="Diminuir"' + (q === 0 ? ' disabled' : '') + '>−</button>' +
      '<input type="number" inputmode="numeric" pattern="[0-9]*" min="0" step="1" value="' + q + '" aria-label="Quantidade" data-act="set">' +
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
      '<div class="card-head"><img loading="lazy" src="' + esc(p.image) + '" alt="' + esc(p.name) + '">' +
      '<div><span class="code">#' + p.code + ' · ' + esc(p.category) + '</span>' +
      '<h3>' + esc(p.name) + '</h3><p class="use">' + esc(p.use) + '</p></div></div>' +
      variantsHtml('product', p) + '<div class="card-sub"></div></article>';
  }

  function kitCard(k) {
    const names = k.items.map((id) => prodById[id].name);
    return '<article class="card" data-item="kit:' + k.id + '">' +
      '<div class="card-head"><img loading="lazy" src="' + esc(k.image) + '" alt="' + esc(k.name) + '">' +
      '<div><span class="code">' + k.fardos + ' fardos · ' + (k.fardos * 10) + ' pacotes</span>' +
      '<h3>' + esc(k.name) + '</h3><p class="use">' + esc(k.description) + ' Um fardo de cada sabor.</p>' +
      '<details class="kit-items"><summary>Ver os ' + k.fardos + ' sabores</summary>' + names.map(esc).join(' · ') + '</details></div></div>' +
      variantsHtml('kit', k) + '<div class="card-sub"></div></article>';
  }

  function displayCard(d) {
    const key = C.lineKey('display', d.id, 'un');
    return '<article class="card" data-item="display:' + d.id + '">' +
      '<div class="card-head">' + (ICONS[d.icon] || '') +
      '<div><span class="code">Expositor · ' + esc(d.group) + '</span>' +
      '<h3>' + esc(d.name) + '</h3><p class="use">' + esc(d.description) + '</p></div></div>' +
      '<div class="variant' + (state.cart[key] ? ' active' : '') + '" data-vkey="' + esc(key) + '">' +
        '<span class="size">Qtd</span><span class="price free">Sem valor no pedido</span>' + stepperHtml(key) + '</div>' +
      '<div class="card-sub"></div></article>';
  }

  function matches(item, extra) {
    if (!state.query) return true;
    const hay = norm([item.name, item.use || '', item.description || '', item.category || '', item.group || '', item.code || '', extra || '',
      (item.variants || []).map((v) => v.size).join(' ')].join(' '));
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
    } else if (state.tab === 'display') {
      CATALOG.displays.forEach((d) => {
        if (state.category !== 'Todos' && d.group !== state.category) return;
        if (!matches(d)) return;
        html += displayCard(d); count++;
      });
    } else {
      // "No pedido": only items already in the cart
      const ids = new Set(Object.keys(state.cart).map((k) => k.split('|')[0]));
      CATALOG.products.forEach((p) => { if (ids.has('product:' + p.id) && matches(p)) { html += productCard(p); count++; } });
      CATALOG.kits.forEach((k) => { if (ids.has('kit:' + k.id) && matches(k)) { html += kitCard(k); count++; } });
      CATALOG.displays.forEach((d) => { if (ids.has('display:' + d.id) && matches(d)) { html += displayCard(d); count++; } });
    }
    $('#list').innerHTML = html;
    $('#empty').hidden = count > 0;
    $('#empty').textContent = state.tab === 'selected' ? 'Nenhum item no pedido ainda. Use o botão + nos produtos.' : 'Nenhum item encontrado.';
    $$('.card').forEach(updateCard);
  }

  // Refresh one card's steppers and subtotal without re-rendering (keeps input focus).
  function updateCard(card) {
    let sub = 0, fardos = 0, units = 0, isDisplay = false;
    $$('.variant', card).forEach((row) => {
      const key = row.dataset.vkey;
      const meta = INDEX[key];
      const q = state.cart[key] || 0;
      row.classList.toggle('active', q > 0);
      const input = $('input', row);
      if (document.activeElement !== input) input.value = q;
      $('.minus', row).disabled = q === 0;
      sub += q * meta.unitCents;
      fardos += q * meta.fardosPerUnit;
      units += q;
      if (meta.type === 'display') isDisplay = true;
    });
    card.classList.toggle('has-qty', units > 0);
    $('.card-sub', card).textContent = units === 0 ? '' :
      isDisplay ? units + ' expositor(es) no pedido' : fardos + ' fardo(s) · ' + C.formatBRL(sub);
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
  function imageHtml(line) {
    if (line.type === 'display') return ICONS[dispById[line.id].icon] || '';
    const src = line.type === 'kit' ? kitById[line.id].image : prodById[line.id].image;
    return '<img src="' + esc(src) + '" alt="">';
  }

  function lineMeta(l) {
    if (l.type === 'display') return 'Expositor · ' + l.qty + ' un. · sem valor';
    return (l.type === 'kit' ? 'Kit · ' + l.fardosPerUnit + ' fardos cada · ' : '#' + l.code + ' · ') +
      C.formatBRL(l.unitCents) + ' × ' + l.qty;
  }

  function renderReview() {
    const s = C.summarize(state.cart, INDEX);
    $('#review-lines').innerHTML = s.lines.length ? s.lines.map((l) =>
      '<div class="rline">' + imageHtml(l) +
        '<div><div class="rname">' + esc(l.name) + (l.type === 'display' ? '' : ' · ' + esc(l.size)) + '</div>' +
        '<div class="rmeta">' + lineMeta(l) + '</div>' +
        (l.type === 'display' ? '' : '<div class="rsub">' + C.formatBRL(l.subtotalCents) + '</div>') + '</div>' +
        '<div class="ractions">' + stepperHtml(l.key) +
          '<button type="button" class="remove" data-remove="' + esc(l.key) + '">Remover</button></div>' +
      '</div>').join('') : '<p class="empty">Pedido vazio.</p>';
    $('#review-totals').innerHTML =
      '<div><span>Itens (linhas)</span><span>' + s.lines.length + '</span></div>' +
      '<div><span>Total de fardos</span><span>' + s.totalFardos + '</span></div>' +
      '<div><span>Total de pacotes (10 por fardo)</span><span>' + s.totalUnits + '</span></div>' +
      (s.totalDisplays ? '<div><span>Expositores</span><span>' + s.totalDisplays + '</span></div>' : '') +
      '<div class="grand"><span>TOTAL</span><span>' + C.formatBRL(s.totalCents) + '</span></div>';
    $('#btn-finish').disabled = s.lines.length === 0;
    $('#btn-finish').textContent = state.editingNumber ? 'Salvar alterações e gerar PDF' : 'Finalizar e gerar PDF';
  }

  function fillSelects() {
    $('#customer-form [name=paymentMethod]').innerHTML = '<option value="">Selecione…</option>' +
      C.PAYMENT_METHODS.map((m) => '<option>' + esc(m) + '</option>').join('');
    $('#customer-form [name=paymentTerm]').innerHTML = '<option value="">Selecione…</option>' +
      C.PAYMENT_TERMS.map((m) => '<option>' + esc(m) + '</option>').join('');
  }

  function fillCustomerForm() {
    const f = $('#customer-form');
    Array.from(f.elements).forEach((el) => {
      if (!el.name) return;
      if (el.type === 'checkbox') el.checked = !!state.customer[el.name];
      else el.value = state.customer[el.name] || '';
    });
  }

  function readCustomerForm() {
    const f = $('#customer-form');
    const c = {};
    Array.from(f.elements).forEach((el) => {
      if (!el.name) return;
      c[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    return c;
  }

  function open(id) { $('#' + id).hidden = false; document.body.style.overflow = 'hidden'; }
  function close(id) { $('#' + id).hidden = true; if ($$('.overlay').every((o) => o.hidden)) document.body.style.overflow = ''; }

  // ---------- Finish / PDF ----------
  function finishOrder() {
    state.customer = readCustomerForm();
    persistDraft();
    const s = C.summarize(state.cart, INDEX);
    if (!s.lines.length) { toast('O pedido está vazio.'); return; }

    const now = new Date().toISOString();
    const base = { customer: state.customer, cart: Object.assign({}, state.cart), totalCents: s.totalCents, totalFardos: s.totalFardos, totalDisplays: s.totalDisplays };
    let order;
    if (state.editingNumber) {
      const i = state.orders.findIndex((o) => o.number === state.editingNumber);
      const prev = i >= 0 ? state.orders[i] : {};
      order = Object.assign({ number: state.editingNumber, createdAt: prev.createdAt || now, updatedAt: now }, base);
      if (i >= 0) state.orders[i] = order; else state.orders.unshift(order);
    } else {
      order = Object.assign({ number: C.nextOrderNumber(state.orders.map((o) => o.number)), createdAt: now }, base);
      state.orders.unshift(order);
    }
    persistOrders(order);
    state.lastOrder = order;
    // Further changes to this cart update the same saved order instead of duplicating it.
    state.editingNumber = order.number;
    persistDraft();
    close('review');
    const where = Remote.ready ? 'salvo online e neste aparelho' : 'salvo neste aparelho';
    $('#done-body').innerHTML =
      '<p><strong>' + esc(order.number) + '</strong>' + (order.customer.store ? ' · ' + esc(order.customer.store) : '') + '</p>' +
      '<p>' + s.lines.length + ' itens · ' + s.totalFardos + ' fardos' + (s.totalDisplays ? ' · ' + s.totalDisplays + ' expositor(es)' : '') +
        ' · <strong>' + C.formatBRL(s.totalCents) + '</strong></p>' +
      '<p class="hint">Pedido ' + where + ' (veja em “Pedidos salvos”). Baixe o PDF ou compartilhe direto pelo WhatsApp.</p>';
    open('done');
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
      if (!Remote.downloads && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Pedido ' + order.number,
          text: 'Pedido ' + order.number + (order.customer.store ? ' · ' + order.customer.store : '') + ' · ' + C.formatBRL(order.totalCents) });
      } else {
        // In the Claude app the download prompt opens the phone's share sheet.
        const ok = await offerFile(P.pdfFileName(order), blob);
        if (ok && !Remote.downloads) toast('Este navegador não compartilha arquivos direto; o PDF foi baixado.');
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
      const c = o.customer || {};
      return '<div class="hline" data-number="' + esc(o.number) + '">' +
        '<div class="htop"><span>' + esc(o.number) + ' · ' + esc(c.store || 'Sem nome') + '</span><span>' + C.formatBRL(s.totalCents) + '</span></div>' +
        '<div class="hmeta">' + new Date(o.createdAt).toLocaleString('pt-BR') + (o.updatedAt ? ' · editado ' + new Date(o.updatedAt).toLocaleString('pt-BR') : '') +
          ' · ' + s.lines.length + ' itens · ' + s.totalFardos + ' fardos' + (s.totalDisplays ? ' · ' + s.totalDisplays + ' expositor(es)' : '') +
          (c.paymentMethod || c.paymentTerm ? ' · ' + esc([c.paymentMethod, c.paymentTerm].filter(Boolean).join(' ')) : '') + '</div>' +
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
      if (hasDraft() && state.editingNumber !== number && !(await confirmSafe('Substituir o pedido em andamento pelo pedido ' + number + '?', 'Substituir'))) return;
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
          if (o && o.number && o.cart && !known.has(o.number)) { state.orders.push(o); known.add(o.number); added++; remoteSaveOrder(o); }
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
      state.category = 'Todos';
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

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.stepper button');
      if (btn) { changeQty(btn.closest('.stepper').dataset.key, btn.dataset.act); return; }
      const rm = e.target.closest('[data-remove]');
      if (rm) { state.cart = C.removeLine(state.cart, rm.dataset.remove); persistDraft(); renderReview(); renderList(); updateTotals(); return; }
      const h = e.target.closest('[data-h]');
      if (h) { historyAction(h.closest('.hline').dataset.number, h.dataset.h); return; }
      if (e.target.closest('[data-close]')) { close(e.target.closest('.overlay').id); return; }
      if (e.target.classList.contains('overlay') && e.target.id !== 'confirm') close(e.target.id);
    });
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
    $('#customer-form').addEventListener('change', () => { state.customer = readCustomerForm(); persistDraft(); });
    $('#customer-form').addEventListener('submit', (e) => e.preventDefault());
    $('#btn-clear').addEventListener('click', async () => {
      if (!(await confirmSafe('Limpar todos os itens do pedido atual?', 'Limpar'))) return;
      state.cart = {}; state.editingNumber = null; persistDraft(); renderReview(); renderList(); updateTotals();
    });
    $('#btn-finish').addEventListener('click', finishOrder);
    $('#btn-done-download').addEventListener('click', () => state.lastOrder && downloadPdf(state.lastOrder));
    $('#btn-done-share').addEventListener('click', () => state.lastOrder && sharePdf(state.lastOrder));
    $('#btn-new-order').addEventListener('click', () => { newOrder(); close('done'); toast('Novo pedido iniciado.'); });
    $('#btn-history').addEventListener('click', () => { renderHistory(); setStorageLabel(); open('history'); });
    $('#btn-export').addEventListener('click', exportBackup);
    $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });

    // GitHub online storage settings
    $('#gh-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const cfg = { repo: $('#gh-repo').value.trim(), token: $('#gh-token').value.trim() };
      if (!cfg.token) { const old = load(GH_KEY, {}) || {}; cfg.token = old.token; }
      const btn = $('#gh-connect'); btn.disabled = true; btn.textContent = 'Conectando…';
      const ok = await connectGitHub(cfg, false);
      btn.disabled = false; btn.textContent = 'Conectar e sincronizar';
      if (ok) { save(GH_KEY, cfg); $('#gh-token').value = ''; renderHistory(); setStorageLabel(); }
    });
    $('#gh-disconnect').addEventListener('click', async () => {
      if (!(await confirmSafe('Desconectar o GitHub deste aparelho? Os pedidos continuam salvos no GitHub e aqui.', 'Desconectar'))) return;
      drop(GH_KEY);
      if (Remote.kind === 'github') { Remote.kind = null; Remote.ready = false; Remote.gh = null; }
      Remote.lastError = '';
      setStorageLabel();
    });
  }

  // ---------- Init ----------
  $('#count-products').textContent = CATALOG.products.length;
  $('#count-kits').textContent = CATALOG.kits.length;
  $('#count-displays').textContent = CATALOG.displays.length;
  fillSelects();
  bind();
  renderChips();
  renderList();
  updateTotals();
  setStorageLabel();
  initRemote();

  // Expose for automated tests / debugging.
  window.CDTApp = { state, INDEX, Remote, summarize: () => C.summarize(state.cart, INDEX) };
})();
