import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Pagination from '../../components/common/Pagination';
import { getInvoices, getInvoiceById, getSupplierDetails } from '../../services/invoiceService';
import InvoiceDetail from '../invoices/InvoiceDetail';
import {
    MdReceipt,
    MdRefresh,
    MdClose,
    MdVisibility,
    MdSearch,
    MdFileDownload,
    MdCheckCircle,
} from 'react-icons/md';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import '../invoices/Invoices.css';

const formatDate = (date) => {
    if (!date) return '—';
    const d = date instanceof Date ? date : new Date(date);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const formatCurrency = (amt) => `£${(amt || 0).toFixed(2)}`;

const RestaurantInvoices = () => {
    const { currentUser } = useAuth();
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [viewInvoice, setViewInvoice] = useState(null);
    const [supplierDetails, setSupplierDetails] = useState(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(15);

    const restaurantId = currentUser?.uid;

    const fetchData = useCallback(async () => {
        if (!restaurantId) return;
        setLoading(true);
        try {
            const filters = { restaurant_id: restaurantId };
            if (dateFrom) filters.date_from = dateFrom;
            if (dateTo) filters.date_to = dateTo;
            const data = await getInvoices(filters);
            setInvoices(data);
            const sup = await getSupplierDetails();
            setSupplierDetails(sup);
        } catch (err) {
            console.error('Failed to load invoices:', err);
            toast.error('Failed to load invoices');
        } finally {
            setLoading(false);
        }
    }, [restaurantId, dateFrom, dateTo]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ── Filtered ──
    const filteredInvoices = searchQuery
        ? invoices.filter(inv => {
            const q = searchQuery.toLowerCase();
            return (
                inv.invoice_number?.toLowerCase().includes(q) ||
                inv.order_number?.toLowerCase().includes(q)
            );
        })
        : invoices;

    // Reset page on filter change
    useEffect(() => { setCurrentPage(1); }, [searchQuery, dateFrom, dateTo]);

    const paginatedInvoices = filteredInvoices.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // ── View invoice ──
    const handleViewInvoice = async (inv) => {
        try {
            const full = await getInvoiceById(inv.id);
            setViewInvoice(full || inv);
        } catch {
            setViewInvoice(inv);
        }
    };

    // ── Export ──
    const handleExport = () => {
        const data = filteredInvoices.map(inv => ({
            'Invoice #': inv.invoice_number || '—',
            'Order #': inv.order_number || '—',
            'Date': formatDate(inv.invoice_date),
            'Net (£)': (inv.subtotal || 0).toFixed(2),
            'VAT (£)': (inv.total_vat || 0).toFixed(2),
            'Discount (£)': (inv.discount_amount || 0).toFixed(2),
            'Total (£)': (inv.grand_total || 0).toFixed(2),
            'Status': inv.status || '—',
        }));
        if (!data.length) { toast.error('No invoices to export'); return; }
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
        XLSX.writeFile(wb, `Restaurant_Invoices_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success('Exported to Excel');
    };

    // ── Status badge ──
    const getStatusBadge = (status) => {
        switch (status) {
            case 'issued': return <span className="badge badge-info"><MdCheckCircle /> Issued</span>;
            case 'paid': return <span className="badge badge-success"><MdCheckCircle /> Paid</span>;
            default: return <span className="badge badge-muted">{status || '—'}</span>;
        }
    };

    // ── Stats ──
    const stats = {
        total: filteredInvoices.length,
        totalAmount: filteredInvoices.reduce((s, i) => s + (i.grand_total || 0), 0),
        totalVat: filteredInvoices.reduce((s, i) => s + (i.total_vat || 0), 0),
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdReceipt style={{ marginRight: 'var(--space-2)' }} />
                        My Invoices
                    </h1>
                    <p className="page-subtitle">
                        {stats.total} invoice{stats.total !== 1 ? 's' : ''} — Total: <strong>{formatCurrency(stats.totalAmount)}</strong> (VAT: {formatCurrency(stats.totalVat)})
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                    <button className="btn btn-secondary btn-md" onClick={handleExport}>
                        <MdFileDownload /> Export Excel
                    </button>
                    <button className="btn-refresh" onClick={fetchData} title="Refresh">
                        <MdRefresh />
                    </button>
                </div>
            </div>

            {/* Filters Row */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
                    <MdSearch className="search-icon" />
                    <input
                        className="search-input"
                        placeholder="Search by invoice or order number..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button className="search-clear" onClick={() => setSearchQuery('')}>
                            <MdClose />
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <input
                        type="date"
                        className="form-input"
                        value={dateFrom}
                        onChange={e => setDateFrom(e.target.value)}
                        style={{ width: 150, fontSize: 'var(--text-sm)' }}
                    />
                    <span style={{ color: 'var(--color-text-muted)' }}>to</span>
                    <input
                        type="date"
                        className="form-input"
                        value={dateTo}
                        onChange={e => setDateTo(e.target.value)}
                        style={{ width: 150, fontSize: 'var(--text-sm)' }}
                    />
                </div>
            </div>

            {/* Table */}
            {loading ? (
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Invoice #</th><th>Order #</th><th>Date</th>
                                <th>Net</th><th>VAT</th><th>Discount</th><th>Total</th>
                                <th>Status</th><th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: 5 }).map((_, i) => (
                                <tr key={i}>
                                    {Array.from({ length: 9 }).map((_, j) => (
                                        <td key={j}><div className="skeleton skeleton-text" style={{ height: 16, width: '70%' }} /></td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : filteredInvoices.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
                    <MdReceipt style={{ fontSize: 48, opacity: 0.3, marginBottom: 'var(--space-4)', color: 'var(--color-text-muted)' }} />
                    <h3 style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                        No Invoices Found
                    </h3>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                        Invoices will appear here when your orders from Central Kitchen are completed.
                    </p>
                </div>
            ) : (
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Invoice #</th>
                                <th>Order #</th>
                                <th>Date</th>
                                <th>Net (£)</th>
                                <th>VAT (£)</th>
                                <th>Discount</th>
                                <th>Total (£)</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedInvoices.map(inv => (
                                <tr key={inv.id}>
                                    <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>
                                        {inv.invoice_number || '—'}
                                    </td>
                                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
                                        {inv.order_number || '—'}
                                    </td>
                                    <td style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                                        {formatDate(inv.invoice_date)}
                                    </td>
                                    <td>{formatCurrency(inv.subtotal)}</td>
                                    <td style={{ color: 'var(--color-text-muted)' }}>{formatCurrency(inv.total_vat)}</td>
                                    <td>
                                        {inv.discount_amount > 0 ? (
                                            <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                                                -{formatCurrency(inv.discount_amount)}
                                            </span>
                                        ) : '—'}
                                    </td>
                                    <td style={{ fontWeight: 700 }}>{formatCurrency(inv.grand_total)}</td>
                                    <td>{getStatusBadge(inv.status)}</td>
                                    <td>
                                        <button
                                            className="btn-action"
                                            onClick={() => handleViewInvoice(inv)}
                                            title="View Invoice"
                                            style={{ color: 'var(--color-primary)' }}
                                        >
                                            <MdVisibility />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pagination */}
            {!loading && filteredInvoices.length > 0 && (
                <Pagination
                    currentPage={currentPage}
                    totalItems={filteredInvoices.length}
                    itemsPerPage={itemsPerPage}
                    onPageChange={setCurrentPage}
                    onItemsPerPageChange={setItemsPerPage}
                />
            )}

            {/* Invoice Detail Modal */}
            {viewInvoice && (
                <InvoiceDetail
                    invoice={viewInvoice}
                    onClose={() => setViewInvoice(null)}
                    supplierDetails={supplierDetails}
                    onUpdated={(updatedInv) => {
                        if (updatedInv) {
                            // Update modal view with fresh data
                            setViewInvoice(updatedInv);
                            // Update the invoice in the list so the table reflects changes
                            setInvoices(prev => prev.map(inv => inv.id === updatedInv.id ? { ...inv, ...updatedInv } : inv));
                        } else {
                            setViewInvoice(null);
                            fetchData();
                        }
                    }}
                />
            )}
        </div>
    );
};

export default RestaurantInvoices;
