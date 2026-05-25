/**
 * Order Export Service — PDF & Excel exports for the Orders pivot grid.
 *
 * Exports:
 *   downloadPDF         — Landscape A3 combined pivot grid PDF
 *   downloadExcel       — Single sheet with categories + restaurant columns
 *   downloadDispatchPDF — Portrait A4, one page per restaurant (dispatch-ready)
 *   downloadDispatchExcel — One sheet per restaurant (dispatch-ready)
 */
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

const formatDate = () => {
    return new Date().toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        timeZone: 'Europe/London',
    });
};

const fileDate = () => new Date().toISOString().split('T')[0];

// Restaurant total helper
const getRestaurantTotal = (matrix, restaurantName) => {
    let total = 0;
    Object.entries(matrix).forEach(([key, qty]) => {
        if (key.endsWith(`::${restaurantName}`)) total += qty;
    });
    return total;
};

// ═══════════════════════════════════════════
// 1. DOWNLOAD PDF — Combined grid (landscape)
// ═══════════════════════════════════════════

/**
 * @param {Object} gridData
 * @param {Object} gridData.categorizedItems  — { categoryName: [item, ...] }
 * @param {Array}  gridData.restaurants       — ['Restaurant A', 'Restaurant B']
 * @param {Object} gridData.matrix            — { 'itemName::restaurantName': quantity }
 * @param {Object} gridData.itemTotals        — { 'itemName': totalQty }
 * @param {Object} gridData.itemUnits         — { 'itemName': 'kg' }
 */
export const downloadPDF = (gridData) => {
    const { categorizedItems, restaurants, matrix, itemTotals } = gridData;

    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a3',
    });

    // Title
    doc.setFontSize(22);
    doc.text("Today's Orders Grid", 15, 15);
    doc.setFontSize(10);
    doc.text(`Generated: ${formatDate()}`, 15, 22);

    // Headers
    const headers = ['Item', 'Unit', ...restaurants, 'Total'];

    // Build rows
    const rows = [];
    const sortedCategories = Object.keys(categorizedItems).sort();

    sortedCategories.forEach(category => {
        // Category row
        rows.push({
            content: [category, '', ...Array(restaurants.length).fill(''), ''],
            isCategory: true,
        });

        const items = [...categorizedItems[category]].sort((a, b) =>
            a.item_name.localeCompare(b.item_name)
        );

        items.forEach(item => {
            const row = [item.item_name, item.unit || ''];
            restaurants.forEach(r => {
                const key = `${item.item_name}::${r}`;
                const qty = matrix[key] || 0;
                row.push(qty > 0 ? qty.toString() : '-');
            });
            row.push((itemTotals[item.item_name] || 0).toString());
            rows.push({ content: row, isCategory: false });
        });
    });

    // Grand total row
    const grandTotalRow = ['Total', ''];
    let grandTotal = 0;
    restaurants.forEach(r => {
        const rTotal = getRestaurantTotal(matrix, r);
        grandTotalRow.push(rTotal.toString());
        grandTotal += rTotal;
    });
    grandTotalRow.push(grandTotal.toString());
    rows.push({ content: grandTotalRow, isCategory: false, isGrandTotal: true });

    autoTable(doc, {
        head: [headers],
        body: rows.map(r => r.content),
        startY: 28,
        theme: 'grid',
        styles: {
            fontSize: 11,
            cellPadding: 3,
            font: 'helvetica',
            lineColor: [0, 0, 0],
            lineWidth: 0.3,
        },
        headStyles: {
            fillColor: [44, 62, 80],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 11,
            lineColor: [0, 0, 0],
            lineWidth: 0.4,
        },
        alternateRowStyles: {
            fillColor: [245, 245, 245],
        },
        willDrawCell: (data) => {
            if (data?.row?.index !== undefined) {
                const rowInfo = rows[data.row.index];
                if (rowInfo?.isCategory) {
                    doc.setFillColor(201, 169, 110); // Gold
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                    doc.setTextColor(0, 0, 0);
                    doc.setFontSize(12);
                    doc.setFont('helvetica', 'bold');
                    doc.setDrawColor(0, 0, 0);
                    doc.setLineWidth(0.4);
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height);
                }
                if (rowInfo?.isGrandTotal) {
                    doc.setFillColor(220, 220, 220);
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                    doc.setTextColor(0, 0, 0);
                    doc.setFont('helvetica', 'bold');
                    doc.setDrawColor(0, 0, 0);
                    doc.setLineWidth(0.5);
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height);
                }
            }
        },
    });

    doc.save(`todays_orders_grid_${fileDate()}.pdf`);
};

// ═══════════════════════════════════════════
// 2. DOWNLOAD EXCEL — Combined grid
// ═══════════════════════════════════════════

export const downloadExcel = (gridData) => {
    const { categorizedItems, restaurants, matrix, itemTotals } = gridData;
    const workbook = XLSX.utils.book_new();
    const worksheetData = [];

    // Header row
    worksheetData.push(['Item', 'Unit', ...restaurants, 'Total']);

    const sortedCategories = Object.keys(categorizedItems).sort();

    sortedCategories.forEach(category => {
        // Category row
        worksheetData.push([category, '', ...Array(restaurants.length + 1).fill('')]);

        const items = [...categorizedItems[category]].sort((a, b) =>
            a.item_name.localeCompare(b.item_name)
        );

        items.forEach(item => {
            const row = [item.item_name, item.unit || ''];
            restaurants.forEach(r => {
                const key = `${item.item_name}::${r}`;
                row.push(matrix[key] || 0);
            });
            row.push(itemTotals[item.item_name] || 0);
            worksheetData.push(row);
        });
    });

    // Grand total row
    const totalRow = ['Total', ''];
    let grandTotal = 0;
    restaurants.forEach(r => {
        const rTotal = getRestaurantTotal(matrix, r);
        totalRow.push(rTotal);
        grandTotal += rTotal;
    });
    totalRow.push(grandTotal);
    worksheetData.push(totalRow);

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Column widths
    const colWidths = worksheetData[0].map(() => ({ wch: 16 }));
    colWidths[0] = { wch: 30 };
    worksheet['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, "Today's Orders");
    XLSX.writeFile(workbook, `todays_orders_${fileDate()}.xlsx`);
};

// ═══════════════════════════════════════════
// 3. DISPATCH PDF — One page per restaurant
// ═══════════════════════════════════════════

export const downloadDispatchPDF = (gridData) => {
    const { categorizedItems, restaurants, matrix } = gridData;

    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
    });

    let isFirstPage = true;

    restaurants.forEach(restaurantName => {
        if (!isFirstPage) doc.addPage();
        isFirstPage = false;

        // Title
        doc.setFontSize(18);
        doc.text(restaurantName, 15, 15);
        doc.setFontSize(10);
        doc.text(`Dispatch Order — Generated: ${formatDate()}`, 15, 22);

        const headers = ['#', 'Item', 'Unit', 'Quantity'];
        const rows = [];
        const sortedCategories = Object.keys(categorizedItems).sort();
        let restaurantTotal = 0;
        let itemNumber = 0;

        sortedCategories.forEach(category => {
            const items = [...categorizedItems[category]].sort((a, b) =>
                a.item_name.localeCompare(b.item_name)
            );

            // Check if category has any items for this restaurant
            const categoryHasItems = items.some(item => {
                const key = `${item.item_name}::${restaurantName}`;
                return (matrix[key] || 0) > 0;
            });

            if (categoryHasItems) {
                // Category row
                rows.push({
                    content: ['', category, '', ''],
                    isCategory: true,
                });

                items.forEach(item => {
                    const key = `${item.item_name}::${restaurantName}`;
                    const qty = matrix[key] || 0;
                    if (qty > 0) {
                        itemNumber++;
                        rows.push({
                            content: [itemNumber.toString(), item.item_name, item.unit || '', qty.toString()],
                            isCategory: false,
                        });
                        restaurantTotal += qty;
                    }
                });
            }
        });

        // Total row
        rows.push({
            content: ['', 'TOTAL', '', restaurantTotal.toString()],
            isGrandTotal: true,
        });

        autoTable(doc, {
            head: [headers],
            body: rows.map(r => r.content),
            startY: 28,
            theme: 'grid',
            styles: {
                fontSize: 11,
                cellPadding: 3,
                font: 'helvetica',
                lineColor: [0, 0, 0],
                lineWidth: 0.3,
            },
            headStyles: {
                fillColor: [44, 62, 80],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                lineColor: [0, 0, 0],
                lineWidth: 0.4,
            },
            columnStyles: {
                0: { cellWidth: 12 },  // # column narrow
                3: { halign: 'center', fontStyle: 'bold' },  // Qty centered + bold
            },
            alternateRowStyles: {
                fillColor: [245, 245, 245],
            },
            willDrawCell: (data) => {
                if (data?.row?.index !== undefined) {
                    const rowInfo = rows[data.row.index];
                    if (rowInfo?.isCategory) {
                        doc.setFillColor(201, 169, 110);
                        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                        doc.setTextColor(0, 0, 0);
                        doc.setFontSize(11);
                        doc.setFont('helvetica', 'bold');
                        doc.setDrawColor(0, 0, 0);
                        doc.setLineWidth(0.4);
                        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height);
                    }
                    if (rowInfo?.isGrandTotal) {
                        doc.setFillColor(220, 220, 220);
                        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                        doc.setTextColor(0, 0, 0);
                        doc.setFont('helvetica', 'bold');
                        doc.setDrawColor(0, 0, 0);
                        doc.setLineWidth(0.5);
                        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height);
                    }
                }
            },
        });
    });

    doc.save(`dispatch_orders_${fileDate()}.pdf`);
};

// ═══════════════════════════════════════════
// 4. DISPATCH EXCEL — One sheet per restaurant
// ═══════════════════════════════════════════

export const downloadDispatchExcel = (gridData) => {
    const { categorizedItems, restaurants, matrix } = gridData;
    const workbook = XLSX.utils.book_new();

    restaurants.forEach(restaurantName => {
        const worksheetData = [];

        // Restaurant title row
        worksheetData.push([`Dispatch Order — ${restaurantName}`]);
        worksheetData.push([`Generated: ${formatDate()}`]);
        worksheetData.push([]);  // blank row

        // Header row
        worksheetData.push(['#', 'Item', 'Unit', 'Quantity']);

        const sortedCategories = Object.keys(categorizedItems).sort();
        let restaurantTotal = 0;
        let itemNumber = 0;

        sortedCategories.forEach(category => {
            const items = [...categorizedItems[category]].sort((a, b) =>
                a.item_name.localeCompare(b.item_name)
            );

            // Check if category has any items for this restaurant
            const categoryHasItems = items.some(item => {
                const key = `${item.item_name}::${restaurantName}`;
                return (matrix[key] || 0) > 0;
            });

            if (categoryHasItems) {
                // Category row
                worksheetData.push(['', category, '', '']);

                items.forEach(item => {
                    const key = `${item.item_name}::${restaurantName}`;
                    const qty = matrix[key] || 0;
                    if (qty > 0) {
                        itemNumber++;
                        worksheetData.push([itemNumber, item.item_name, item.unit || '', qty]);
                        restaurantTotal += qty;
                    }
                });
            }
        });

        // Total row
        worksheetData.push([]);
        worksheetData.push(['', 'TOTAL', '', restaurantTotal]);

        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

        // Column widths
        worksheet['!cols'] = [
            { wch: 5 },   // #
            { wch: 30 },  // Item
            { wch: 10 },  // Unit
            { wch: 12 },  // Quantity
        ];

        // Sheet name (max 31 chars for Excel)
        const sheetName = restaurantName.length > 31
            ? restaurantName.substring(0, 31)
            : restaurantName;

        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    });

XLSX.writeFile(workbook, `dispatch_orders_${fileDate()}.xlsx`);
};

// ═══════════════════════════════════════════
// 5. SINGLE ORDER PDF — Individual order detail
// ═══════════════════════════════════════════

/**
 * Generate a PDF for a single order.
 * @param {Object} order — Full order object with items, totals, etc.
 */
export const downloadSingleOrderPDF = (order) => {
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();

    // ── Header ──
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('WATAN', 15, 18);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Central Kitchen', 15, 24);

    // Order number right-aligned
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`Order ${order.order_number || ''}`, pageWidth - 15, 18, { align: 'right' });

    // Divider
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(15, 28, pageWidth - 15, 28);

    // ── Order Info ──
    let yPos = 36;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    const infoRows = [
        ['Restaurant:', order.restaurant_name || '—'],
        ['Order Date:', order.created_at ? new Date(order.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'],
        ['Status:', (order.status || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())],
    ];

    if (order.invoice_number) {
        infoRows.push(['Invoice #:', order.invoice_number]);
    }

    infoRows.forEach(([label, value]) => {
        doc.setFont('helvetica', 'bold');
        doc.text(label, 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(value, 55, yPos);
        yPos += 6;
    });

    yPos += 4;

    // ── Items Table ──
    const items = order.items || [];
    const tableHeaders = ['#', 'Item', 'Qty', 'Unit', 'Price', 'VAT %', 'Total'];
    const tableRows = items.map((item, idx) => [
        (idx + 1).toString(),
        item.item_name || '',
        (item.quantity || 0).toString(),
        item.unit || '',
        `£${(item.selling_price || 0).toFixed(2)}`,
        `${item.vat_rate || 0}%`,
        `£${(item.line_total || 0).toFixed(2)}`,
    ]);

    autoTable(doc, {
        head: [tableHeaders],
        body: tableRows,
        startY: yPos,
        theme: 'grid',
        styles: {
            fontSize: 10,
            cellPadding: 3,
            font: 'helvetica',
            lineColor: [0, 0, 0],
            lineWidth: 0.2,
        },
        headStyles: {
            fillColor: [44, 62, 80],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 10,
            lineColor: [0, 0, 0],
            lineWidth: 0.3,
        },
        columnStyles: {
            0: { cellWidth: 10, halign: 'center' },
            1: { cellWidth: 60 },
            2: { cellWidth: 15, halign: 'center' },
            3: { cellWidth: 20 },
            4: { cellWidth: 25, halign: 'right' },
            5: { cellWidth: 18, halign: 'center' },
            6: { cellWidth: 25, halign: 'right' },
        },
        alternateRowStyles: {
            fillColor: [245, 245, 245],
        },
    });

    // ── Totals ──
    const finalY = doc.lastAutoTable.finalY + 6;

    const totalsData = [
        ['Subtotal', `£${(order.subtotal || 0).toFixed(2)}`],
        ['VAT', `£${(order.vat_amount || 0).toFixed(2)}`],
        ['Total', `£${(order.total || 0).toFixed(2)}`],
    ];

    totalsData.forEach(([label, value], idx) => {
        const y = finalY + idx * 7;
        const isBold = idx === totalsData.length - 1;
        doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        doc.setFontSize(isBold ? 12 : 10);
        doc.text(label, pageWidth - 65, y, { align: 'right' });
        doc.text(value, pageWidth - 15, y, { align: 'right' });
        if (isBold) {
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.5);
            doc.line(pageWidth - 75, y - 4, pageWidth - 15, y - 4);
        }
    });

    // ── Notes ──
    if (order.notes) {
        const notesY = finalY + totalsData.length * 7 + 10;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Notes:', 15, notesY);
        doc.setFont('helvetica', 'normal');
        const splitNotes = doc.splitTextToSize(order.notes, pageWidth - 30);
        doc.text(splitNotes, 15, notesY + 6);
    }

    // ── Footer ──
    const footerY = doc.internal.pageSize.getHeight() - 12;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated: ${formatDate()}`, 15, footerY);
    doc.text('Watan Central Kitchen', pageWidth - 15, footerY, { align: 'right' });

    const orderNum = (order.order_number || 'order').replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(`order_${orderNum}_${fileDate()}.pdf`);
};
