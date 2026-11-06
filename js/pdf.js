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
    const rows = [
      ['Loja / Razão social', c.store || '-'],
      ['CNPJ / CPF', c.doc || '-'],
      ['Contato', c.contact || '-'],
      ['Telefone / WhatsApp', c.phone || '-'],
      ['Cidade / UF', c.city || '-'],
      ['Endereço de entrega', c.address || '-'],
      ['Pagamento', c.payment || '-'],
    ];
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

    const body = sum.lines.map((l, i) => {
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

    // Totals box
    let y = doc.lastAutoTable.finalY + 6;
    if (y > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); y = 20; }
    const boxW = 80;
    const x = pageW - margin - boxW;
    doc.setDrawColor.apply(doc, GREEN);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, boxW, 30, 2, 2);
    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.setFont('helvetica', 'normal');
    doc.text('Linhas do pedido:', x + 4, y + 6); doc.text(String(sum.lines.length), x + boxW - 4, y + 6, { align: 'right' });
    doc.text('Total de fardos:', x + 4, y + 11); doc.text(String(sum.totalFardos), x + boxW - 4, y + 11, { align: 'right' });
    doc.text('Total de pacotes (10 por fardo):', x + 4, y + 16); doc.text(String(sum.totalUnits), x + boxW - 4, y + 16, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor.apply(doc, RED);
    doc.text('TOTAL:', x + 4, y + 25);
    doc.text(C.formatBRL(sum.totalCents), x + boxW - 4, y + 25, { align: 'right' });

    // Notes
    if (order.customer && order.customer.notes) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor.apply(doc, GREEN);
      doc.text('Observações', margin, y + 5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40);
      doc.text(doc.splitTextToSize(order.customer.notes, pageW - 2 * margin - boxW - 6), margin, y + 10);
    }
    return doc;
  }

  function pdfFileName(order) {
    const store = ((order.customer && order.customer.store) || 'cliente')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'Pedido-' + order.number + '-' + store + '.pdf';
  }

  root.OrderPdf = { buildOrderPdf, pdfFileName };
})(self);
