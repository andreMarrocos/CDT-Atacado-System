/*
 * CDT Atacado System - PDF generation for a finished order.
 * Uses jsPDF + jsPDF-AutoTable (vendored in /vendor, no CDN needed).
 */
(function (root) {
  'use strict';
  const C = root.OrderCore;
  const GREEN = [35, 92, 52];
  const RED = [176, 38, 38];
  const TERRACOTA = [166, 78, 52];

  // Build a jsPDF document for an order object produced by app.js.
  function buildOrderPdf(order, catalog) {
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;

    // Header: logo + title + order number
    try { doc.addImage(root.CDT_LOGO_PNG, 'PNG', margin, 8, 42, 18.8); } catch (e) { /* logo is optional */ }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor.apply(doc, TERRACOTA);
    doc.text('Pedido de Atacado', pageW - margin, 15, { align: 'right' });
    doc.setFontSize(10);
    doc.setTextColor(40);
    doc.text('Nº ' + order.number, pageW - margin, 21, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(new Date(order.createdAt).toLocaleString('pt-BR'), pageW - margin, 26, { align: 'right' });

    doc.setDrawColor.apply(doc, TERRACOTA);
    doc.setLineWidth(0.6);
    doc.line(margin, 30, pageW - margin, 30);

    // Customer block
    const c = order.customer || {};
    const address = [c.address, c.city].filter(Boolean).join(' - ');
    const payment = [c.paymentMethod || c.payment, c.paymentTerm].filter(Boolean).join(' · ');
    const rows = [
      ['Cliente / Loja', c.store || '-'],
      ['CNPJ', c.doc || '-'],
      ['Telefone / WhatsApp', c.phone || '-'],
      ['Endereço de entrega', (address || '-') + (address ? (c.addressConfirmed ? '  (confirmado)' : '  (não confirmado)') : '')],
      ['Pagamento', payment || 'A combinar'],
    ];
    if (c.contact) rows.splice(1, 0, ['Contato', c.contact]);
    doc.autoTable({
      startY: 33,
      body: rows,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 1 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42, textColor: GREEN } },
      margin: { left: margin, right: margin },
    });

    // Item table
    const sum = C.summarize(order.cart, C.buildIndex(catalog));
    const kitById = {};
    catalog.kits.forEach((k) => { kitById[k.id] = k; });
    const prodById = {};
    catalog.products.forEach((p) => { prodById[p.id] = p; });

    const saleLines = sum.lines.filter((l) => l.type !== 'display');
    const displayLines = sum.lines.filter((l) => l.type === 'display');
    const body = saleLines.map((l, i) => {
      let name = l.name;
      if (l.type === 'kit') {
        const kit = kitById[l.id];
        name += '\n(' + kit.fardos + ' fardos: ' + kit.items.map((id) => prodById[id].name).join(', ') + ')';
      }
      return [
        String(i + 1),
        l.type === 'kit' ? 'KIT' : l.code,
        name,
        l.size,
        quantityLabel(l),
        String(l.fardos * 10),
        C.formatBRL(l.unitCents),
        C.formatBRL(l.subtotalCents),
      ];
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 4,
      head: [['#', 'Cód.', 'Produto', 'Gram.', 'Quantidade', 'Pacotes', 'Preço un.', 'Subtotal']],
      body: body,
      theme: 'striped',
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 9, halign: 'center' },
      styles: { fontSize: 8.5, cellPadding: 1.6, valign: 'middle' },
      columnStyles: {
        0: { cellWidth: 7, halign: 'center' },
        1: { cellWidth: 11, halign: 'center' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 15, halign: 'center' },
        4: { cellWidth: 25, halign: 'center', fontStyle: 'bold', fontSize: 9.5, textColor: [20, 20, 20] },
        5: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
        6: { cellWidth: 22, halign: 'right' },
        7: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: margin, right: margin, bottom: 18 },
      didDrawPage: function () {
        // Footer on every page
        const h = doc.internal.pageSize.getHeight();
        doc.setFontSize(7.5);
        doc.setTextColor(110);
        doc.text('Clube do Tempero Lojista · WhatsApp (41) 98834-0629 · Valores em R$ por fardo com 10 unidades · Condições de pagamento confirmadas na cotação.',
          pageW / 2, h - 8, { align: 'center' });
        doc.text('Página ' + doc.internal.getNumberOfPages(), pageW - margin, h - 4, { align: 'right' });
      },
    });

    // Display stands (no price)
    if (displayLines.length) {
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 5,
        head: [['#', 'Expositor solicitado', 'Qtd']],
        body: displayLines.map((l, i) => [String(i + 1), l.name, String(l.qty)]),
        theme: 'striped',
        headStyles: { fillColor: TERRACOTA, textColor: 255, fontSize: 9 },
        styles: { fontSize: 8.5, cellPadding: 1.6 },
        columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 2: { cellWidth: 16, halign: 'center' } },
        margin: { left: margin, right: margin, bottom: 18 },
      });
    }

    // Totals box
    let y = doc.lastAutoTable.finalY + 6;
    if (y > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); y = 20; }
    const boxW = 80;
    const x = pageW - margin - boxW;
    doc.setDrawColor.apply(doc, GREEN);
    doc.setLineWidth(0.4);
    const boxH = displayLines.length ? 35 : 30;
    doc.roundedRect(x, y, boxW, boxH, 2, 2);
    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.setFont('helvetica', 'normal');
    let ty = y + 6;
    const row = (label, value) => { doc.text(label, x + 4, ty); doc.text(String(value), x + boxW - 4, ty, { align: 'right' }); ty += 5; };
    row('Itens de produtos/kits:', saleLines.length);
    row('Total de fardos:', sum.totalFardos);
    row('Total de pacotes (10 por fardo):', sum.totalUnits);
    if (displayLines.length) row('Expositores (sem valor):', sum.totalDisplays);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor.apply(doc, RED);
    doc.text('TOTAL:', x + 4, ty + 4);
    doc.text(C.formatBRL(sum.totalCents), x + boxW - 4, ty + 4, { align: 'right' });

    // Notes
    if (order.customer && order.customer.notes) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor.apply(doc, GREEN);
      doc.text('Observações do pedido', margin, y + 5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40);
      doc.text(doc.splitTextToSize(order.customer.notes, pageW - 2 * margin - boxW - 6), margin, y + 10);
    }
    return doc;
  }

  // "3 fardos" for products, "2 kits\n(16 fardos)" for kits.
  function quantityLabel(l) {
    if (l.type === 'kit') return l.qty + (l.qty === 1 ? ' kit' : ' kits') + '\n(' + l.fardos + ' fardos)';
    return l.qty + (l.qty === 1 ? ' fardo' : ' fardos');
  }

  // Picking list for the factory: no prices, kits expanded into flavors, totals per flavor and size.
  function factoryLines(order, catalog) {
    const sum = C.summarize(order.cart, C.buildIndex(catalog));
    const prodById = {};
    catalog.products.forEach((p) => { prodById[p.id] = p; });
    const kitById = {};
    catalog.kits.forEach((k) => { kitById[k.id] = k; });
    const agg = {};
    const add = (pid, size, fardos, origin) => {
      const k = pid + '|' + size;
      if (!agg[k]) agg[k] = { code: prodById[pid].code, name: prodById[pid].name, size: size, fardos: 0, origins: [] };
      agg[k].fardos += fardos;
      if (origin && agg[k].origins.indexOf(origin) === -1) agg[k].origins.push(origin);
    };
    sum.lines.forEach((l) => {
      if (l.type === 'product') add(l.id, l.size, l.qty, 'avulso');
      else if (l.type === 'kit') kitById[l.id].items.forEach((pid) => add(pid, l.size, l.qty, l.name));
    });
    const items = Object.values(agg).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || (parseInt(a.size, 10) - parseInt(b.size, 10)));
    return { items: items, displays: sum.lines.filter((l) => l.type === 'display'), totalFardos: sum.totalFardos };
  }

  function buildFactoryPdf(order, catalog) {
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;
    const f = factoryLines(order, catalog);
    const c = order.customer || {};

    try { doc.addImage(root.CDT_LOGO_PNG, 'PNG', margin, 8, 36, 16.1); } catch (e) { /* logo is optional */ }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor.apply(doc, GREEN);
    doc.text('Separação para a fábrica', pageW - margin, 14, { align: 'right' });
    doc.setFontSize(10);
    doc.setTextColor(40);
    doc.text('Pedido Nº ' + order.number, pageW - margin, 20, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(new Date(order.createdAt).toLocaleString('pt-BR'), pageW - margin, 25, { align: 'right' });
    doc.setDrawColor.apply(doc, GREEN);
    doc.setLineWidth(0.6);
    doc.line(margin, 28, pageW - margin, 28);

    doc.setFontSize(10);
    let y = 34;
    if (c.store) { doc.setFont('helvetica', 'bold'); doc.text('Cliente: ', margin, y); doc.setFont('helvetica', 'normal'); doc.text(c.store, margin + 16, y); y += 5; }
    const address = [c.address, c.city].filter(Boolean).join(' - ');
    if (address) { doc.setFont('helvetica', 'bold'); doc.text('Entrega: ', margin, y); doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(address, pageW - 2 * margin - 18), margin + 16, y); y += 5; }

    doc.autoTable({
      startY: y + 1,
      head: [['', 'Cód.', 'Sabor', 'Gramatura', 'Fardos', 'Pacotes']],
      body: f.items.map((it) => ['', it.code, it.name + (it.origins.some((o) => o !== 'avulso') ? '\n(' + it.origins.join(' + ') + ')' : ''),
        it.size, String(it.fardos), String(it.fardos * 10)]),
      foot: [['', '', 'TOTAL', '', String(f.totalFardos), String(f.totalFardos * 10)]],
      theme: 'grid',
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 10, halign: 'center' },
      footStyles: { fillColor: [235, 242, 236], textColor: 20, fontSize: 11, fontStyle: 'bold', halign: 'center' },
      styles: { fontSize: 10, cellPadding: 2, valign: 'middle', lineColor: [200, 200, 200] },
      columnStyles: {
        0: { cellWidth: 9 },
        1: { cellWidth: 13, halign: 'center' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 24, halign: 'center', fontStyle: 'bold' },
        4: { cellWidth: 22, halign: 'center', fontStyle: 'bold', fontSize: 13 },
        5: { cellWidth: 22, halign: 'center', fontSize: 11 },
      },
      didDrawCell: function (data) {
        // Empty checkbox in the first column for ticking items while picking
        if (data.section === 'body' && data.column.index === 0) {
          doc.setDrawColor(90); doc.setLineWidth(0.3);
          doc.rect(data.cell.x + 2.2, data.cell.y + data.cell.height / 2 - 2.2, 4.4, 4.4);
        }
      },
      margin: { left: margin, right: margin, bottom: 16 },
      didDrawPage: function () {
        const h = doc.internal.pageSize.getHeight();
        doc.setFontSize(8); doc.setTextColor(110);
        doc.text('Pedido ' + order.number + ' · 1 fardo = 10 pacotes · Kits já somados por sabor', margin, h - 6);
        doc.text('Página ' + doc.internal.getNumberOfPages(), pageW - margin, h - 6, { align: 'right' });
      },
    });

    if (f.displays.length) {
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 6,
        head: [['', 'Expositor', 'Qtd']],
        body: f.displays.map((l) => ['', l.name, String(l.qty)]),
        theme: 'grid',
        headStyles: { fillColor: TERRACOTA, textColor: 255, fontSize: 10 },
        styles: { fontSize: 10, cellPadding: 2 },
        columnStyles: { 0: { cellWidth: 9 }, 2: { cellWidth: 22, halign: 'center', fontStyle: 'bold', fontSize: 13 } },
        didDrawCell: function (data) {
          if (data.section === 'body' && data.column.index === 0) {
            doc.setDrawColor(90); doc.setLineWidth(0.3);
            doc.rect(data.cell.x + 2.2, data.cell.y + data.cell.height / 2 - 2.2, 4.4, 4.4);
          }
        },
        margin: { left: margin, right: margin, bottom: 16 },
      });
    }

    if (c.notes) {
      let ny = doc.lastAutoTable.finalY + 8;
      if (ny > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); ny = 20; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor.apply(doc, GREEN);
      doc.text('Observações', margin, ny);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(40);
      doc.text(doc.splitTextToSize(c.notes, pageW - 2 * margin), margin, ny + 5);
    }
    return doc;
  }

  function factoryFileName(order) {
    return pdfFileName(order).replace(/^Pedido-/, 'Fabrica-');
  }

  function pdfFileName(order) {
    const store = ((order.customer && order.customer.store) || 'pedido')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'Pedido-' + order.number + '-' + store + '.pdf';
  }

  root.OrderPdf = { buildOrderPdf, pdfFileName, buildFactoryPdf, factoryFileName, factoryLines };
})(self);
