import React, { useState, useEffect, useCallback } from 'react';
import Pagination from '../../components/common/Pagination';
import { useNavigate } from 'react-router-dom';
import {
    getPurchaseOrders,
    getUniqueVendors,
    PO_STATUSES,
    getStatusInfo,
    updateReceivedPurchaseReview,
    updatePurchaseOrder,
} from '../../services/purchaseService';
import {
    MdHistory,
    MdAdd,
    MdRefresh,
    MdFileDownload,
    MdClose,
    MdFilterList,
    MdVisibility,
    MdSearch,
    MdShoppingCart,
    MdPictureAsPdf,
    MdEdit,
    MdSave,
} from 'react-icons/md';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import toast from 'react-hot-toast';
import './Purchase.css';

const PurchaseHistory = () => {
    const navigate = useNavigate();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [vendors, setVendors] = useState([]);
    const [filters, setFilters] = useState({
        status: '',
        vendor: '',
        dateFrom: '',
        dateTo: '',
        search: '',
    });
    const [detailModal, setDetailModal] = useState(null);
    const [reviewModal, setReviewModal] = useState(null);
    const [reviewData, setReviewData] = useState(null);
    const [editModal, setEditModal] = useState(null);
    const [editData, setEditData] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const toDateInput = (value) => {
        if (!value) return '';
        const date = value?.toDate ? value.toDate() : new Date(value);
        return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    };

    // ── Company Info ──
    const COMPANY = {
        name: 'Watan Central Kitchen',
        address: '123 High Street, London, UK',
        phone: '+44 20 1234 5678',
        email: 'orders@watan.com',
        tagline: 'Quality Food, Delivered Fresh',
    };

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getPurchaseOrders({
                ...(filters.status && { status: filters.status }),
                ...(filters.vendor && { vendor: filters.vendor }),
                ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
                ...(filters.dateTo && { dateTo: filters.dateTo }),
            });
            setOrders(data);
        } catch (err) {
            toast.error('Failed to load purchase history');
        } finally {
            setLoading(false);
        }
    }, [filters.status, filters.vendor, filters.dateFrom, filters.dateTo]);

    useEffect(() => { fetchOrders(); }, [fetchOrders]);

    useEffect(() => {
        const loadVendors = async () => {
            try {
                const v = await getUniqueVendors();
                setVendors(v);
            } catch (e) { /* ignore */ }
        };
        loadVendors();
    }, []);

    const filteredOrders = orders.filter(o => {
        if (!filters.search) return true;
        const q = filters.search.toLowerCase();
        return (
            o.po_number?.toLowerCase().includes(q) ||
            o.vendor?.toLowerCase().includes(q) ||
            o.items?.some(i => i.item_name?.toLowerCase().includes(q))
        );
    });

    // Reset page on filter change
    useEffect(() => { setCurrentPage(1); }, [filters]);

    const paginatedOrders = filteredOrders.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const formatDate = (date) => {
        if (!date) return '—';
        return new Date(date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        });
    };

    const formatDateTime = (date) => {
        if (!date) return '—';
        return new Date(date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    // ── Export to PDF ──
    const handleExportPDF = () => {
        if (filteredOrders.length === 0) {
            toast.error('No data to export');
            return;
        }

        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        doc.setFontSize(18);
        doc.text('Purchase History', 15, 15);
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, 15, 22);

        const rows = filteredOrders.map(o => [
            o.po_number,
            getStatusInfo(o.status).label,
            o.vendor || '',
            o.items?.length || 0,
            `£${(o.total_amount || 0).toFixed(2)}`,
            `£${(o.received_total || 0).toFixed(2)}`,
            formatDate(o.created_at),
            formatDate(o.expected_delivery_date),
            formatDate(o.received_at),
        ]);

        autoTable(doc, {
            head: [['PO Number', 'Status', 'Vendor', 'Items', 'Order Total', 'Received', 'Created Date', 'Expected Date', 'Received Date']],
            body: rows,
            startY: 28,
            theme: 'grid',
            headStyles: { fillColor: [44, 62, 80] },
            styles: { fontSize: 9 },
        });

        doc.save(`Watan_Purchase_History_${new Date().toISOString().split('T')[0]}.pdf`);
        toast.success('Exported to PDF');
    };

    // ── Generate Single PO PDF ──
    const generatePOPdf = (order) => {
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();

        // Company Header
        doc.setFillColor(44, 62, 80);
        doc.rect(0, 0, pageWidth, 38, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(COMPANY.name, 15, 18);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(COMPANY.address, 15, 25);
        doc.text(`Phone: ${COMPANY.phone}  |  Email: ${COMPANY.email}`, 15, 31);

        // PO Title
        doc.setTextColor(44, 62, 80);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('PURCHASE ORDER', 15, 50);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(order.po_number || '', pageWidth - 15, 50, { align: 'right' });

        // Divider
        doc.setDrawColor(200, 200, 200);
        doc.line(15, 54, pageWidth - 15, 54);

        // Order Info
        let y = 62;
        doc.setFontSize(10);
        doc.setTextColor(80, 80, 80);
        const info = [
            ['Vendor', order.vendor || '—'],
            ['Status', getStatusInfo(order.status).label],
            ['Date Created', formatDate(order.created_at)],
            ['Expected Delivery', formatDate(order.expected_delivery_date)],
        ];
        if (order.received_at) info.push(['Received Date', formatDate(order.received_at)]);
        if (order.notes) info.push(['Notes', order.notes]);

        info.forEach(([label, value]) => {
            doc.setFont('helvetica', 'bold');
            doc.text(`${label}:`, 15, y);
            doc.setFont('helvetica', 'normal');
            doc.text(String(value), 55, y);
            y += 6;
        });

        y += 4;

        // Items Table
        const rows = (order.items || []).map((item, idx) => [
            idx + 1,
            item.item_name,
            item.category_name || '',
            `${item.quantity} ${item.unit}`,
            item.received_quantity != null ? `${item.received_quantity} ${item.unit}` : '—',
            `£${(item.received_price || item.unit_price || 0).toFixed(2)}`,
            `£${((item.received_quantity || item.quantity) * (item.received_price || item.unit_price || 0)).toFixed(2)}`,
        ]);

        autoTable(doc, {
            head: [['#', 'Item', 'Category', 'Ordered', 'Received', 'Unit Price', 'Total']],
            body: rows,
            startY: y,
            theme: 'grid',
            headStyles: { fillColor: [44, 62, 80], fontSize: 9 },
            styles: { fontSize: 9, cellPadding: 3 },
            columnStyles: {
                0: { cellWidth: 10 },
                5: { halign: 'right' },
                6: { halign: 'right' },
            },
        });

        // Totals after table
        const finalY = doc.lastAutoTable.finalY + 8;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text('Order Total:', pageWidth - 70, finalY);
        doc.setFont('helvetica', 'bold');
        doc.text(`£${(order.total_amount || 0).toFixed(2)}`, pageWidth - 15, finalY, { align: 'right' });

        if (order.received_total != null) {
            doc.setFont('helvetica', 'normal');
            doc.text('Received Total:', pageWidth - 70, finalY + 7);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(39, 174, 96);
            doc.text(`£${(order.received_total || 0).toFixed(2)}`, pageWidth - 15, finalY + 7, { align: 'right' });
        }

        // Footer
        const footerY = doc.internal.pageSize.getHeight() - 12;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.setFont('helvetica', 'italic');
        doc.text(`Generated on ${new Date().toLocaleDateString('en-GB')} — ${COMPANY.name}`, pageWidth / 2, footerY, { align: 'center' });

        doc.save(`${order.po_number || 'PO'}.pdf`);
        toast.success(`Downloaded ${order.po_number}.pdf`);
    };

    // ── Export to Excel ──
    const handleExportExcel = () => {
        if (filteredOrders.length === 0) {
            toast.error('No data to export');
            return;
        }

        // Summary sheet
        const summaryData = filteredOrders.map(o => ({
            'PO Number': o.po_number,
            'Status': getStatusInfo(o.status).label,
            'Vendor': o.vendor || '',
            'Items Count': o.items?.length || 0,
            'Order Total (£)': (o.total_amount || 0).toFixed(2),
            'Received Total (£)': (o.received_total || 0).toFixed(2),
            'Created': formatDate(o.created_at),
            'Expected Delivery': formatDate(o.expected_delivery_date),
            'Received Date': formatDate(o.received_at),
            'Notes': o.notes || '',
        }));
        const wsSummary = XLSX.utils.json_to_sheet(summaryData);

        // Line items sheet
        const lineItems = [];
        filteredOrders.forEach(o => {
            (o.items || []).forEach(item => {
                lineItems.push({
                    'PO Number': o.po_number,
                    'Vendor': o.vendor || '',
                    'Item Name': item.item_name,
                    'Item Type': item.item_type,
                    'Category': item.category_name || '',
                    'Unit': item.unit,
                    'Ordered Qty': item.quantity,
                    'Received Qty': item.received_quantity || 0,
                    'Unit Price (£)': item.unit_price?.toFixed(2),
                    'Received Price (£)': item.received_price?.toFixed(2) || '',
                    'Line Total (£)': (item.quantity * item.unit_price).toFixed(2),
                    'Batch ID': item.batch_id || '',
                });
            });
        });
        const wsLines = XLSX.utils.json_to_sheet(lineItems);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Purchase Orders');
        XLSX.utils.book_append_sheet(wb, wsLines, 'Line Items');

        XLSX.writeFile(wb, `Watan_Purchase_History_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success('Exported to Excel');
    };

    const clearFilters = () => {
        setFilters({ status: '', vendor: '', dateFrom: '', dateTo: '', search: '' });
    };

    const hasFilters = filters.status || filters.vendor || filters.dateFrom || filters.dateTo;

    // ── Edit PO helpers ──
    const openEditModal = (order) => {
        setEditModal(order);
        setEditData({
            vendor: order.vendor || '',
            invoice_no: order.invoice_no || '',
            invoice_date: toDateInput(order.invoice_date),
            receive_date: toDateInput(order.receive_date),
            receive_time: order.receive_time || '',
            expected_delivery_date: toDateInput(order.expected_delivery_date),
            notes: order.notes || '',
            items: (order.items || []).map(i => ({
                item_id: i.item_id,
                item_name: i.item_name,
                item_type: i.item_type,
                category_name: i.category_name || '',
                unit: i.unit,
                quantity: i.quantity || 0,
                unit_price: i.unit_price || 0,
                received_quantity: i.received_quantity || 0,
                received_price: i.received_price ?? i.unit_price ?? 0,
                batch_id: i.batch_id || null,
            })),
        });
    };

    const handleSaveEdit = async () => {
        if (!editModal || !editData) return;
        setSavingEdit(true);
        try {
            const updated = await updatePurchaseOrder(editModal.id, editData);
            setOrders(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o));
            setEditModal(null);
            setEditData(null);
            toast.success('Purchase order updated successfully');
        } catch (err) {
            console.error('Failed to update PO:', err);
            toast.error(err.message || 'Failed to update purchase order');
        } finally {
            setSavingEdit(false);
        }
    };

    const updateEditItem = (index, field, value) => {
        setEditData(prev => ({
            ...prev,
            items: prev.items.map((item, i) =>
                i === index ? { ...item, [field]: value } : item
            ),
        }));
    };

    const editOrderTotal = editData
        ? editData.items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0)
        : 0;
    const editReceivedTotal = editData
        ? editData.items.reduce((s, i) => s + (Number(i.received_quantity) || 0) * (Number(i.received_price) || 0), 0)
        : 0;

    // Stats
    const totalSpent = orders.filter(o => o.status === 'received').reduce((s, o) => s + (o.received_total || o.total_amount || 0), 0);
    const pendingCount = orders.filter(o => o.status === 'pending').length;
    const receivedCount = orders.filter(o => o.status === 'received').length;

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdHistory style={{ marginRight: 'var(--space-2)' }} />
                        Purchase History
                    </h1>
                    <p className="page-subtitle">{filteredOrders.length} orders found</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn btn-secondary btn-sm" onClick={handleExportPDF} disabled={filteredOrders.length === 0}>
                        <MdPictureAsPdf /> Export PDF
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={handleExportExcel} disabled={filteredOrders.length === 0}>
                        <MdFileDownload /> Export Excel
                    </button>
                    <button className="btn btn-primary btn-md" onClick={() => navigate('/purchase/create')}>
                        <MdAdd /> New Order
                    </button>
                </div>
            </div>

            {/* Stats Row */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 'var(--space-4)',
                marginBottom: 'var(--space-6)',
            }}>
                {[
                    { label: 'Total Orders', value: orders.length, color: 'var(--color-text-primary)' },
                    { label: 'Pending', value: pendingCount, color: '#f59e0b' },
                    { label: 'Received', value: receivedCount, color: '#22c55e' },
                    { label: 'Total Spent', value: `£${totalSpent.toFixed(2)}`, color: 'var(--color-primary)' },
                ].map((stat, i) => (
                    <div key={i} style={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-lg)',
                        padding: 'var(--space-4)',
                    }}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                            {stat.label}
                        </div>
                        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: stat.color }}>
                            {stat.value}
                        </div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="filters-bar" style={{ marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
                <div className="search-input-wrap" style={{ marginBottom: 'var(--space-2)' }}>
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Search PO number, vendor, or item..."
                        value={filters.search}
                        onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                        style={{ minWidth: 250 }}
                    />
                </div>
                <select
                    className="form-input"
                    value={filters.status}
                    onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}
                    style={{ maxWidth: 180 }}
                >
                    <option value="">All Statuses</option>
                    {PO_STATUSES.map(s => (
                        <option key={s.value} value={s.value}>{s.icon} {s.label}</option>
                    ))}
                </select>
                <select
                    className="form-input"
                    value={filters.vendor}
                    onChange={(e) => setFilters(f => ({ ...f, vendor: e.target.value }))}
                    style={{ maxWidth: 180 }}
                >
                    <option value="">All Vendors</option>
                    {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <input
                    type="date"
                    className="form-input"
                    value={filters.dateFrom}
                    onChange={(e) => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                    style={{ maxWidth: 155 }}
                    title="From date"
                />
                <input
                    type="date"
                    className="form-input"
                    value={filters.dateTo}
                    onChange={(e) => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                    style={{ maxWidth: 155 }}
                    title="To date"
                />
                {hasFilters && (
                    <button className="btn btn-ghost btn-sm" onClick={clearFilters} style={{ color: 'var(--color-danger)' }}>
                        <MdClose /> Clear
                    </button>
                )}
                <button className="btn-refresh" onClick={fetchOrders}><MdRefresh /></button>
            </div>

            {/* Orders Table */}
            <div className="card">
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>PO Number</th>
                                <th>Vendor</th>
                                <th>Items</th>
                                <th>Order Total</th>
                                <th>Status</th>
                                <th>Created</th>
                                <th>Expected</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i}>
                                        {Array.from({ length: 8 }).map((_, j) => (
                                            <td key={j}><div className="skeleton skeleton-text" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : filteredOrders.length === 0 ? (
                                <tr>
                                    <td colSpan="8" style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
                                        <MdShoppingCart style={{ fontSize: 32, display: 'block', margin: '0 auto var(--space-2)' }} />
                                        No purchase orders found
                                    </td>
                                </tr>
                            ) : (
                                paginatedOrders.map(order => {
                                    const status = getStatusInfo(order.status);
                                    return (
                                        <tr key={order.id} style={{ cursor: 'pointer' }} onClick={() => setDetailModal(order)}>
                                            <td>
                                                <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--color-primary)' }}>
                                                    {order.po_number}
                                                </span>
                                            </td>
                                            <td>{order.vendor || '—'}</td>
                                            <td>{order.items?.length || 0}</td>
                                            <td style={{ fontWeight: 600 }}>£{(order.total_amount || 0).toFixed(2)}</td>
                                            <td>
                                                <span className={`po-status-badge ${order.status}`}>
                                                    {status.icon} {status.label}
                                                </span>
                                            </td>
                                            <td>{formatDate(order.created_at)}</td>
                                            <td>{formatDate(order.expected_delivery_date)}</td>
                                            <td>
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        onClick={(e) => { e.stopPropagation(); setDetailModal(order); }}
                                                        title="View Details"
                                                    >
                                                        <MdVisibility size={22} />
                                                    </button>
                                                    {order.status !== 'cancelled' && (
                                                        <button
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={(e) => { e.stopPropagation(); openEditModal(order); }}
                                                            title="Edit Purchase Order"
                                                            style={{ color: 'var(--color-primary)' }}
                                                        >
                                                            <MdEdit size={21} />
                                                        </button>
                                                    )}
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        onClick={(e) => { e.stopPropagation(); generatePOPdf(order); }}
                                                        title="Download PDF"
                                                    >
                                                        <MdPictureAsPdf size={22} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Pagination */}
            {!loading && filteredOrders.length > 0 && (
                <Pagination
                    currentPage={currentPage}
                    totalItems={filteredOrders.length}
                    itemsPerPage={itemsPerPage}
                    onPageChange={setCurrentPage}
                    onItemsPerPageChange={setItemsPerPage}
                />
            )
            }

            {/* ── Detail Modal ── */}
            {
                detailModal && (
                    <div className="modal-overlay" onClick={() => setDetailModal(null)}>
                        <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>Purchase Order — {detailModal.po_number}</h2>
                                <button className="modal-close" onClick={() => setDetailModal(null)}>
                                    <MdClose />
                                </button>
                            </div>
                            <div className="modal-body">
                                {/* Company Header */}
                                <div style={{
                                    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                                    borderRadius: 'var(--radius-lg)',
                                    padding: 'var(--space-5)',
                                    marginBottom: 'var(--space-5)',
                                    color: '#fff',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                                        <div>
                                            <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, letterSpacing: '0.5px' }}>{COMPANY.name}</h3>
                                            <p style={{ margin: '4px 0 0', opacity: 0.8, fontSize: 'var(--text-sm)' }}>{COMPANY.address}</p>
                                            <p style={{ margin: '2px 0 0', opacity: 0.65, fontSize: 'var(--text-xs)' }}>{COMPANY.phone} · {COMPANY.email}</p>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: 'var(--text-xs)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '1px' }}>Purchase Order</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: 2, fontFamily: 'var(--font-mono, monospace)' }}>{detailModal.po_number}</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="po-detail-header">
                                    <span className={`po-status-badge ${detailModal.status}`} style={{ fontSize: 'var(--text-md)', padding: '6px 16px' }}>
                                        {getStatusInfo(detailModal.status).icon} {getStatusInfo(detailModal.status).label}
                                    </span>
                                </div>

                                <div className="po-detail-info-grid">
                                    <div className="po-detail-info-item">
                                        <span className="label">Vendor</span>
                                        <span className="value">{detailModal.vendor || '—'}</span>
                                    </div>
                                    <div className="po-detail-info-item">
                                        <span className="label">Created</span>
                                        <span className="value">{formatDateTime(detailModal.created_at)}</span>
                                    </div>
                                    <div className="po-detail-info-item">
                                        <span className="label">Expected</span>
                                        <span className="value">{formatDate(detailModal.expected_delivery_date)}</span>
                                    </div>
                                    <div className="po-detail-info-item">
                                        <span className="label">Received</span>
                                        <span className="value">{formatDateTime(detailModal.received_at)}</span>
                                    </div>
                                </div>

                                {detailModal.notes && (
                                    <div style={{
                                        background: 'var(--color-bg)',
                                        padding: 'var(--space-3)',
                                        borderRadius: 'var(--radius-md)',
                                        marginBottom: 'var(--space-4)',
                                        fontSize: 'var(--text-sm)',
                                        color: 'var(--color-text-secondary)',
                                    }}>
                                        <strong>Notes:</strong> {detailModal.notes}
                                    </div>
                                )}

                                {/* Line Items Table */}
                                <div className="data-table-wrapper" style={{ maxHeight: 400, overflow: 'auto' }}>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Item</th>
                                                <th>Type</th>
                                                <th>Ordered</th>
                                                <th>Received</th>
                                                <th>Unit Price</th>
                                                <th>Total</th>
                                                <th>Batch</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(detailModal.items || []).map((item, i) => (
                                                <tr key={i}>
                                                    <td style={{ fontWeight: 600 }}>
                                                        {item.item_type === 'raw_meat' ? '🥩' : '🛒'} {item.item_name}
                                                    </td>
                                                    <td>
                                                        <span className="badge badge-info" style={{ fontSize: 'var(--text-xs)' }}>
                                                            {item.item_type}
                                                        </span>
                                                    </td>
                                                    <td>{item.quantity} {item.unit}</td>
                                                    <td style={{
                                                        color: item.received_quantity >= item.quantity
                                                            ? 'var(--color-success)'
                                                            : item.received_quantity > 0
                                                                ? '#f59e0b'
                                                                : 'var(--color-text-muted)',
                                                        fontWeight: 600,
                                                    }}>
                                                        {item.received_quantity || 0} {item.unit}
                                                    </td>
                                                    <td>£{(item.received_price || item.unit_price || 0).toFixed(2)}</td>
                                                    <td style={{ fontWeight: 600 }}>
                                                        £{((item.received_quantity || item.quantity) * (item.received_price || item.unit_price)).toFixed(2)}
                                                    </td>
                                                    <td style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono, monospace)' }}>
                                                        {item.batch_id || '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Totals */}
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    gap: 'var(--space-6)',
                                    marginTop: 'var(--space-4)',
                                    padding: 'var(--space-4)',
                                    background: 'var(--color-bg)',
                                    borderRadius: 'var(--radius-md)',
                                }}>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                                            Order Total
                                        </div>
                                        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
                                            £{(detailModal.total_amount || 0).toFixed(2)}
                                        </div>
                                    </div>
                                    {detailModal.received_total != null && (
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                                                Received Total
                                            </div>
                                            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-primary)' }}>
                                                £{(detailModal.received_total || 0).toFixed(2)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <button className="btn btn-primary btn-md" onClick={() => generatePOPdf(detailModal)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <MdPictureAsPdf /> Download PDF
                                </button>
                                <button className="btn btn-secondary btn-md" onClick={() => setDetailModal(null)}>
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
            {reviewModal && reviewData && <div className="modal-overlay" onClick={() => setReviewModal(null)}><div className="modal modal-lg" onClick={e => e.stopPropagation()}><div className="modal-header"><h2>Review Received Order — {reviewModal.po_number}</h2><button className="modal-close" onClick={() => setReviewModal(null)}><MdClose /></button></div><div className="modal-body"><div className="vendor-invoice-card"><h3 className="vendor-invoice-title">Vendor &amp; Invoice Details</h3><div className="vendor-invoice-grid"><div className="form-group"><label>Vendor</label><select className="form-input" value={reviewData.vendor} onChange={e => setReviewData({ ...reviewData, vendor: e.target.value })}>{reviewData.vendor && !vendors.includes(reviewData.vendor) && <option value={reviewData.vendor}>{reviewData.vendor}</option>}{vendors.map(v => <option key={v} value={v}>{v}</option>)}</select></div><div className="form-group"><label>Invoice No.</label><input className="form-input" value={reviewData.invoice_no} onChange={e => setReviewData({ ...reviewData, invoice_no: e.target.value })} /></div><div className="form-group"><label>Invoice Date</label><input className="form-input" type="date" value={reviewData.invoice_date} onChange={e => setReviewData({ ...reviewData, invoice_date: e.target.value })} /></div></div><div className="form-group"><label>Notes</label><input className="form-input" value={reviewData.receive_notes} onChange={e => setReviewData({ ...reviewData, receive_notes: e.target.value })} /></div></div><div className="data-table-wrapper" style={{ marginTop: 16 }}><table className="data-table"><thead><tr><th>Item</th><th>Received Qty</th><th>Received Price</th></tr></thead><tbody>{reviewData.items.map((item, index) => <tr key={item.item_id}><td>{item.item_name}</td><td>{item.received_quantity}</td><td><input className="form-input" type="number" min="0" step="0.01" value={item.received_price} onChange={e => setReviewData({ ...reviewData, items: reviewData.items.map((i, n) => n === index ? { ...i, received_price: e.target.value } : i) })} /></td></tr>)}</tbody></table></div></div><div className="modal-footer"><button className="btn btn-secondary" onClick={() => setReviewModal(null)}>Cancel</button><button className="btn btn-primary" onClick={async () => { try { const updated = await updateReceivedPurchaseReview(reviewModal.id, reviewData); setOrders(prev => prev.map(o => o.id === updated.id ? updated : o)); setReviewModal(null); toast.success('Received order review saved'); } catch (err) { toast.error(err.message || 'Could not save review'); } }}>Save Review</button></div></div></div>}

            {/* ── Edit PO Modal ── */}
            {editModal && editData && (
                <div className="modal-overlay" onClick={() => { setEditModal(null); setEditData(null); }}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1000, maxHeight: '92vh', overflow: 'auto', borderRadius: 16 }}>
                        <div className="modal-header" style={{ borderBottom: '1px solid var(--color-border)', padding: '20px 24px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <MdEdit size={22} style={{ color: 'var(--color-primary)' }} />
                                <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Edit Purchase Order — {editModal.po_number}</h2>
                                <span className={`po-status-badge ${editModal.status}`} style={{ fontSize: 11 }}>
                                    {getStatusInfo(editModal.status).icon} {getStatusInfo(editModal.status).label}
                                </span>
                            </div>
                            <button className="modal-close" onClick={() => { setEditModal(null); setEditData(null); }}>
                                <MdClose />
                            </button>
                        </div>
                        <div className="modal-body" style={{ padding: '24px' }}>
                            {/* Vendor & Invoice Details */}
                            <div className="vendor-invoice-card" style={{ marginBottom: 'var(--space-5)' }}>
                                <h3 className="vendor-invoice-title">Vendor & Invoice Details</h3>
                                <div className="vendor-invoice-grid">
                                    <div className="form-group">
                                        <label className="form-label">Vendor</label>
                                        <select
                                            className="form-input"
                                            value={editData.vendor}
                                            onChange={(e) => setEditData({ ...editData, vendor: e.target.value })}
                                        >
                                            <option value="">Select Vendor</option>
                                            {editData.vendor && !vendors.includes(editData.vendor) && (
                                                <option value={editData.vendor}>{editData.vendor}</option>
                                            )}
                                            {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Invoice No.</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={editData.invoice_no}
                                            onChange={(e) => setEditData({ ...editData, invoice_no: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Invoice Date</label>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={editData.invoice_date}
                                            onChange={(e) => setEditData({ ...editData, invoice_date: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Expected Delivery</label>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={editData.expected_delivery_date}
                                            onChange={(e) => setEditData({ ...editData, expected_delivery_date: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="vendor-invoice-grid" style={{ marginTop: 'var(--space-3)' }}>
                                    <div className="form-group">
                                        <label className="form-label">Receive Date</label>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={editData.receive_date}
                                            onChange={(e) => setEditData({ ...editData, receive_date: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Receive Time</label>
                                        <input
                                            type="time"
                                            className="form-input"
                                            value={editData.receive_time}
                                            onChange={(e) => setEditData({ ...editData, receive_time: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                        <label className="form-label">Notes</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={editData.notes}
                                            onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                                            placeholder="Vehicle no, driver name, remarks..."
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Items Table */}
                            <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                                📦 Order Items ({editData.items.length})
                            </h4>
                            <div className="data-table-wrapper" style={{ maxHeight: 400, overflow: 'auto' }}>
                                <table className="data-table" style={{ fontSize: 'var(--text-sm)' }}>
                                    <thead>
                                        <tr>
                                            <th>Item</th>
                                            <th>Type</th>
                                            <th>Unit</th>
                                            <th style={{ width: 100 }}>Ordered Qty</th>
                                            <th style={{ width: 100 }}>Unit Price (£)</th>
                                            <th style={{ width: 100 }}>Received Qty</th>
                                            <th style={{ width: 100 }}>Recv Price (£)</th>
                                            <th style={{ textAlign: 'right' }}>Line Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {editData.items.map((item, idx) => (
                                            <tr key={item.item_id || idx}>
                                                <td style={{ fontWeight: 600 }}>
                                                    {item.item_type === 'raw_meat' ? '🥩' : '🛒'} {item.item_name}
                                                </td>
                                                <td>
                                                    <span className="badge badge-info" style={{ fontSize: 'var(--text-xs)' }}>
                                                        {item.item_type}
                                                    </span>
                                                </td>
                                                <td>{item.unit}</td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        className="form-input"
                                                        min="0"
                                                        step="0.01"
                                                        value={item.quantity}
                                                        onChange={(e) => updateEditItem(idx, 'quantity', e.target.value)}
                                                        style={{ width: 90, padding: '6px 8px', textAlign: 'right' }}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        className="form-input"
                                                        min="0"
                                                        step="0.01"
                                                        value={item.unit_price}
                                                        onChange={(e) => updateEditItem(idx, 'unit_price', e.target.value)}
                                                        style={{ width: 90, padding: '6px 8px', textAlign: 'right' }}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        className="form-input"
                                                        min="0"
                                                        step="0.01"
                                                        value={item.received_quantity}
                                                        onChange={(e) => updateEditItem(idx, 'received_quantity', e.target.value)}
                                                        style={{
                                                            width: 90,
                                                            padding: '6px 8px',
                                                            textAlign: 'right',
                                                            borderColor: Number(item.received_quantity) >= Number(item.quantity) ? 'var(--color-success)' : undefined,
                                                        }}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        className="form-input"
                                                        min="0"
                                                        step="0.01"
                                                        value={item.received_price}
                                                        onChange={(e) => updateEditItem(idx, 'received_price', e.target.value)}
                                                        style={{ width: 90, padding: '6px 8px', textAlign: 'right' }}
                                                    />
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                    £{((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)).toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Totals */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'flex-end',
                                gap: 'var(--space-6)',
                                marginTop: 'var(--space-4)',
                                padding: 'var(--space-4)',
                                background: 'var(--color-bg)',
                                borderRadius: 'var(--radius-md)',
                            }}>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                                        Order Total
                                    </div>
                                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
                                        £{editOrderTotal.toFixed(2)}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                                        Received Total
                                    </div>
                                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-primary)' }}>
                                        £{editReceivedTotal.toFixed(2)}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: '16px 24px', borderTop: '1px solid var(--color-border)' }}>
                            <button className="btn btn-secondary btn-md" onClick={() => { setEditModal(null); setEditData(null); }}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary btn-md"
                                onClick={handleSaveEdit}
                                disabled={savingEdit}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                <MdSave size={18} /> {savingEdit ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

export default PurchaseHistory;
