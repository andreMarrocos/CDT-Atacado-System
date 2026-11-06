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
        String(l.qty),
        C.formatBRL(l.unitCents),
        C.formatBRL(l.subtotalCents),
      ];
    });

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 4,
      head: [['#', 'Cód.', 'Produto', 'Gramatura', 'Qtd', 'Preço un.', 'Subtotal']],
      body: body,
      theme: 'striped',
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 9 },
      styles: { fontSize: 8.5, cellPadding: 1.6, valign: 'middle' },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 12, halign: 'center' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 20, halign: 'center' },
        4: { cellWidth: 12, halign: 'center' },
        5: { cellWidth: 24, halign: 'right' },
        6: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
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

  function pdfFileName(order) {
    const store = ((order.customer && order.customer.store) || 'pedido')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'Pedido-' + order.number + '-' + store + '.pdf';
  }

  root.OrderPdf = { buildOrderPdf, pdfFileName };
})(self);
