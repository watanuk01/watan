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
