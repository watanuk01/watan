import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getItems, getUniqueVendors as getItemVendors } from '../../services/inventoryService';
import { createPurchaseOrder, getUniqueVendors, getStatusInfo } from '../../services/purchaseService';
import {
    MdShoppingCart,
    MdAdd,
    MdClose,
    MdSearch,
    MdSend,
    MdArrowBack,
    MdFilterList,
    MdWarning,
    MdCheckCircle,
    MdPictureAsPdf,
    MdCropFree,
    MdAutoFixHigh,
} from 'react-icons/md';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import toast from 'react-hot-toast';
import './Purchase.css';

const DRAFT_KEY = 'watan_po_draft';

const loadDraft = () => {
    try {
        const saved = localStorage.getItem(DRAFT_KEY);
        return saved ? JSON.parse(saved) : null;
    } catch { return null; }
};

const getTodayDateStr = () => new Date().toISOString().substring(0, 10);
const getCurrentTimeStr = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
};
const generateAutoInvoiceNo = () => {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `INV-${today.getFullYear()}-${mm}${dd}`;
};

const CreatePurchaseOrder = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const draft = useRef(loadDraft());
    const [items, setItems] = useState([]);          // all inventory items (grocery + raw_meat)
    const [selectedItems, setSelectedItems] = useState(draft.current?.selectedItems || []);
    const [vendor, setVendor] = useState(draft.current?.vendor || 'ABC Meat Suppliers');
    const [invoiceNo, setInvoiceNo] = useState(draft.current?.invoiceNo || generateAutoInvoiceNo());
    const [invoiceDate, setInvoiceDate] = useState(draft.current?.invoiceDate || getTodayDateStr());
    const [receiveDate, setReceiveDate] = useState(draft.current?.receiveDate || getTodayDateStr());
    const [receiveTime, setReceiveTime] = useState(draft.current?.receiveTime || getCurrentTimeStr());
    const [expectedDate, setExpectedDate] = useState(draft.current?.expectedDate || getTodayDateStr());
    const [notes, setNotes] = useState(draft.current?.notes || '');
    const [submitting, setSubmitting] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [vendors, setVendors] = useState([]);
    const [isCustomVendor, setIsCustomVendor] = useState(false);
    const [customVendor, setCustomVendor] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [lowStockOnly, setLowStockOnly] = useState(false);
    const [successOrder, setSuccessOrder] = useState(null);
    const dropdownRef = useRef(null);

    // Company Info
    const COMPANY = {
        name: 'Watan Central Kitchen',
        address: '123 High Street, London, UK',
        phone: '+44 20 1234 5678',
        email: 'orders@watan.com',
    };

    // ── Save draft to localStorage on every change ──
    const saveDraft = useCallback(() => {
        const data = { selectedItems, vendor, invoiceNo, invoiceDate, receiveDate, receiveTime, expectedDate, notes };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    }, [selectedItems, vendor, invoiceNo, invoiceDate, receiveDate, receiveTime, expectedDate, notes]);

    useEffect(() => { saveDraft(); }, [saveDraft]);

    const clearDraft = () => localStorage.removeItem(DRAFT_KEY);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Only grocery + raw_meat items (cooked meat is production-only)
                const allItems = await getItems({ status: 'active' });
                const purchasable = allItems.filter(i => i.item_type !== 'cooked_meat');
                setItems(purchasable);

                const vendorList = await getUniqueVendors();
                // Also collect vendors from items themselves
                const itemVendors = [...new Set(purchasable.map(i => i.vendor).filter(Boolean))];
                const combined = [...new Set([...vendorList, ...itemVendors])].sort();
                setVendors(combined);
            } catch (err) {
                toast.error('Failed to load inventory items');
            }
        };
        fetchData();
    }, []);

    // ── Pre-fill items from navigation state (e.g., from Low Stock Alerts) ──
    useEffect(() => {
        const prefill = location.state?.prefillItems;
        if (prefill && Array.isArray(prefill) && prefill.length > 0) {
            setSelectedItems(prev => {
                const existing = new Set(prev.map(i => i.item_id));
                const newItems = prefill.filter(i => !existing.has(i.item_id));
                return [...prev, ...newItems];
            });
            // Clear navigation state so refreshing doesn't re-add
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClick = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // Reset category filter when vendor changes
    useEffect(() => {
        setCategoryFilter('');
    }, [vendor]);

    // Get categories available for the selected vendor
    const vendorCategories = useMemo(() => {
        let pool = items;
        if (vendor) {
            pool = pool.filter(i => i.vendor === vendor);
        }
        return [...new Set(pool.map(i => i.category_name).filter(Boolean))].sort();
    }, [items, vendor]);

    // Filtered items: vendor → category → low stock → search → not already added
    const availableItems = useMemo(() => {
        let result = items;

        // 1. Filter by vendor
        if (vendor) {
            result = result.filter(i => i.vendor === vendor);
        }

        // 2. Filter by category
        if (categoryFilter) {
            result = result.filter(i => i.category_name === categoryFilter);
        }

        // 3. Filter low stock only
        if (lowStockOnly) {
            result = result.filter(i => {
                const stock = i.current_stock || 0;
                const reorder = i.reorder_level || i.min_stock || 0;
                return stock <= reorder;
            });
        }

        // 4. Exclude already-added items
        result = result.filter(i => !selectedItems.some(s => s.item_id === i.id));

        // 5. Search filter
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(i =>
                i.name?.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q)
            );
        }

        return result;
    }, [items, vendor, categoryFilter, lowStockOnly, selectedItems, searchQuery]);

    // Count low stock items for the badge
    const lowStockCount = useMemo(() => {
        let pool = items;
        if (vendor) pool = pool.filter(i => i.vendor === vendor);
        if (categoryFilter) pool = pool.filter(i => i.category_name === categoryFilter);
        return pool.filter(i => {
            const stock = i.current_stock || 0;
            const reorder = i.reorder_level || i.min_stock || 0;
            return stock <= reorder;
        }).length;
    }, [items, vendor, categoryFilter]);

    const addItemToPO = (item) => {
        setSelectedItems(prev => [...prev, {
            item_id: item.id,
            item_name: item.name,
            item_type: item.item_type,
            category_name: item.category_name,
            unit: item.unit,
            quantity: 1,
            unit_price: item.cost_price || 0,
            current_stock: item.current_stock || 0,
        }]);
        setSearchQuery('');
        setShowDropdown(false);
    };

    const removeItem = (itemId) => {
        setSelectedItems(prev => prev.filter(i => i.item_id !== itemId));
    };

    const updateItem = (itemId, field, value) => {
        setSelectedItems(prev => prev.map(i =>
            i.item_id === itemId ? { ...i, [field]: value } : i
        ));
    };

    const totalAmount = selectedItems.reduce(
        (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0
    );

    const handleSubmit = async () => {
        const finalVendor = isCustomVendor ? customVendor.trim() : vendor;
        if (!finalVendor) {
            toast.error('Please select or enter a vendor');
            return;
        }

        if (selectedItems.length === 0) {
            toast.error('Please add at least one item');
            return;
        }

        const invalidItems = selectedItems.filter(i => !i.quantity || i.quantity <= 0);
        if (invalidItems.length > 0) {
            toast.error('All items must have a quantity greater than 0');
            return;
        }

        setSubmitting(true);
        try {
            const result = await createPurchaseOrder({
                items: selectedItems,
                vendor: finalVendor,
                expected_delivery_date: expectedDate,
                notes,
            });
            clearDraft();
            toast.success(`Purchase Order ${result.po_number} created!`);
            // Show success modal instead of navigating
            setSuccessOrder(result);
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to create purchase order');
        } finally {
            setSubmitting(false);
        }
    };

    // Generate single PO PDF
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

        doc.setDrawColor(200, 200, 200);
        doc.line(15, 54, pageWidth - 15, 54);

        let y = 62;
        doc.setFontSize(10);
        doc.setTextColor(80, 80, 80);
        const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
        const info = [
            ['Vendor', order.vendor || '—'],
            ['Status', 'Pending'],
            ['Date Created', formatDate(order.created_at)],
            ['Expected Delivery', formatDate(order.expected_delivery_date)],
        ];
        if (order.notes) info.push(['Notes', order.notes]);

        info.forEach(([label, value]) => {
            doc.setFont('helvetica', 'bold');
            doc.text(`${label}:`, 15, y);
            doc.setFont('helvetica', 'normal');
            doc.text(String(value), 55, y);
            y += 6;
        });
        y += 4;

        const rows = (order.items || []).map((item, idx) => [
            idx + 1,
            item.item_name,
            item.category_name || '',
            `${item.quantity} ${item.unit}`,
            `£${(item.unit_price || 0).toFixed(2)}`,
            `£${((item.quantity || 0) * (item.unit_price || 0)).toFixed(2)}`,
        ]);

        autoTable(doc, {
            head: [['#', 'Item', 'Category', 'Quantity', 'Unit Price', 'Total']],
            body: rows,
            startY: y,
            theme: 'grid',
            headStyles: { fillColor: [44, 62, 80], fontSize: 9 },
            styles: { fontSize: 9, cellPadding: 3 },
            columnStyles: { 0: { cellWidth: 10 }, 4: { halign: 'right' }, 5: { halign: 'right' } },
        });

        const finalY = doc.lastAutoTable.finalY + 8;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text('Order Total:', pageWidth - 70, finalY);
        doc.setFont('helvetica', 'bold');
        doc.text(`£${(order.total_amount || 0).toFixed(2)}`, pageWidth - 15, finalY, { align: 'right' });

        const footerY = doc.internal.pageSize.getHeight() - 12;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.setFont('helvetica', 'italic');
        doc.text(`Generated on ${new Date().toLocaleDateString('en-GB')} — ${COMPANY.name}`, pageWidth / 2, footerY, { align: 'center' });

        doc.save(`${order.po_number || 'PO'}.pdf`);
        toast.success(`Downloaded ${order.po_number}.pdf`);
    };

    const getTypeIcon = (type) => type === 'raw_meat' ? '🥩' : '🛒';

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdShoppingCart style={{ marginRight: 'var(--space-2)' }} />
                        Create Purchase Order
                    </h1>
                    <p className="page-subtitle">Select items, quantities, and vendor to place a purchase order</p>
                </div>
                <button className="btn btn-secondary btn-md" onClick={() => navigate('/purchase/pending')}>
                    <MdArrowBack /> Back to Orders
                </button>
            </div>

            {/* Vendor & Invoice Details */}
            <div className="vendor-invoice-card">
                <h3 className="vendor-invoice-title">Vendor &amp; Invoice Details</h3>

                <div className="vendor-invoice-grid">
                    <div className="form-group">
                        <label className="form-label">Vendor <span className="required" style={{ color: 'var(--color-danger)' }}>*</span></label>
                        {isCustomVendor ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                                <input
                                    type="text"
                                    className="form-input"
                                    style={{ flex: 1 }}
                                    placeholder="Enter new vendor name..."
                                    value={customVendor}
                                    onChange={(e) => setCustomVendor(e.target.value)}
                                />
                                <button
                                    type="button"
                                    className="btn-text-link"
                                    style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                                    onClick={() => setIsCustomVendor(false)}
                                >
                                    Select List
                                </button>
                            </div>
                        ) : (
                            <select
                                className="form-input"
                                value={vendor}
                                onChange={(e) => {
                                    if (e.target.value === '__CUSTOM_VENDOR__') {
                                        setIsCustomVendor(true);
                                    } else {
                                        setVendor(e.target.value);
                                    }
                                }}
                            >
                                <option value="">Select Vendor</option>
                                {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                                <option value="__CUSTOM_VENDOR__">+ Enter New Vendor Name...</option>
                            </select>
                        )}
                    </div>

                    <div className="form-group">
                        <label className="form-label">Invoice No <span className="required" style={{ color: 'var(--color-danger)' }}>*</span></label>
                        <input
                            type="text"
                            className="form-input"
                            value={invoiceNo}
                            onChange={(e) => setInvoiceNo(e.target.value)}
                            placeholder="INV-2026-0618"
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Invoice Date</label>
                        <input
                            type="date"
                            className="form-input"
                            value={invoiceDate}
                            onChange={(e) => setInvoiceDate(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Receive Date</label>
                        <input
                            type="date"
                            className="form-input"
                            value={receiveDate}
                            onChange={(e) => setReceiveDate(e.target.value)}
                        />
                    </div>
                </div>

                <div className="vendor-invoice-row-2">
                    <div className="form-group">
                        <label className="form-label">Receive Time</label>
                        <input
                            type="time"
                            className="form-input"
                            value={receiveTime}
                            onChange={(e) => setReceiveTime(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Notes</label>
                        <input
                            type="text"
                            className="form-input"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Vehicle no, driver name, remarks..."
                        />
                    </div>
                </div>
            </div>

            {/* Item Selector */}
            <div className="po-item-selector">
                <div className="po-item-selector-header">
                    <h3>📦 Order Items ({selectedItems.length})</h3>
                </div>

                {/* Filter Bar */}
                <div style={{
                    display: 'flex',
                    gap: 'var(--space-3)',
                    marginBottom: 'var(--space-4)',
                    flexWrap: 'nowrap',
                    alignItems: 'center',
                    overflowX: 'auto',
                    paddingBottom: 4,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <MdFilterList style={{ color: 'var(--color-text-muted)' }} />
                    </div>

                    {/* Category filter */}
                    <select
                        className="form-input"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        style={{ padding: '8px 12px', minWidth: 150, fontSize: 'var(--text-sm)', flexShrink: 0 }}
                    >
                        <option value="">All Categories</option>
                        {vendorCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>

                    {/* Low Stock toggle */}
                    <button
                        className={`btn btn-sm ${lowStockOnly ? 'btn-warning' : 'btn-secondary'}`}
                        onClick={() => setLowStockOnly(prev => !prev)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            flexShrink: 0,
                            padding: '8px 14px',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 600,
                            ...(lowStockOnly ? {
                                background: 'rgba(245, 158, 11, 0.15)',
                                color: '#f59e0b',
                                border: '1px solid rgba(245, 158, 11, 0.4)',
                            } : {}),
                        }}
                    >
                        <MdWarning /> Low Stock {lowStockCount > 0 && `(${lowStockCount})`}
                    </button>

                    {/* Active filter summary */}
                    {(vendor || categoryFilter || lowStockOnly) && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', flexShrink: 0, marginLeft: 'auto' }}>
                            {availableItems.length} items available
                        </div>
                    )}
                </div>

                {/* Full-width search bar */}
                <div className="po-add-item-dropdown" ref={dropdownRef} style={{ marginBottom: 'var(--space-4)' }}>
                    <div style={{ position: 'relative' }}>
                        <MdSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontSize: 20 }} />
                        <input
                            type="text"
                            className="po-add-item-search"
                            style={{ paddingLeft: 40, width: '100%' }}
                            placeholder={vendor ? `Search ${vendor} items...` : "Search items to add to your order..."}
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setShowDropdown(true);
                            }}
                            onFocus={() => setShowDropdown(true)}
                        />
                    </div>
                    {showDropdown && availableItems.length > 0 && (
                        <div className="po-add-item-results">
                            {availableItems.slice(0, 20).map(item => {
                                const isLow = (item.current_stock || 0) <= (item.reorder_level || item.min_stock || 0);
                                return (
                                    <div
                                        key={item.id}
                                        className="po-add-item-option"
                                        onClick={() => addItemToPO(item)}
                                    >
                                        <div className="item-info">
                                            <span className="name">{getTypeIcon(item.item_type)} {item.name}</span>
                                            <span className="meta">{item.category_name} · {item.unit} · £{item.cost_price?.toFixed(2)}{item.vendor ? ` · ${item.vendor}` : ''}</span>
                                        </div>
                                        <div className="stock-info" style={isLow ? { color: '#ef4444', fontWeight: 600 } : {}}>
                                            {isLow && <MdWarning style={{ verticalAlign: 'middle', marginRight: 2 }} />}
                                            Stock: {item.current_stock || 0} {item.unit}
                                        </div>
                                    </div>
                                );
                            })}
                            {availableItems.length > 20 && (
                                <div style={{ padding: '8px 12px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                                    + {availableItems.length - 20} more items — refine your search
                                </div>
                            )}
                        </div>
                    )}
                    {showDropdown && availableItems.length === 0 && searchQuery && (
                        <div className="po-add-item-results">
                            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                                No matching items found{vendor ? ` for "${vendor}"` : ''}
                            </div>
                        </div>
                    )}
                </div>

                {selectedItems.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        padding: 'var(--space-8)',
                        color: 'var(--color-text-muted)',
                        fontSize: 'var(--text-sm)'
                    }}>
                        <MdAdd style={{ fontSize: 32, marginBottom: 'var(--space-2)', display: 'block', margin: '0 auto' }} />
                        Search and add items to your purchase order
                    </div>
                ) : (
                    <>
                        {/* Header Row */}
                        <div className="po-item-row" style={{ background: 'transparent', border: 'none', padding: 'var(--space-2) var(--space-3)', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <span>Item</span>
                            <span>Current Stock</span>
                            <span>Qty to Order</span>
                            <span>Unit Price (£)</span>
                            <span>Total</span>
                            <span></span>
                        </div>

                        <div className="po-items-list">
                            {selectedItems.map(item => {
                                const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
                                return (
                                    <div key={item.item_id} className="po-item-row">
                                        <div>
                                            <div className="item-name">{getTypeIcon(item.item_type)} {item.item_name}</div>
                                            <div className="item-meta">{item.category_name} · {item.unit}</div>
                                        </div>
                                        <div style={{ fontSize: 'var(--text-sm)', color: item.current_stock <= 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                                            {item.current_stock} {item.unit}
                                        </div>
                                        <input
                                            type="number"
                                            className="qty-input"
                                            value={item.quantity}
                                            onChange={(e) => updateItem(item.item_id, 'quantity', e.target.value === '' ? '' : Number(e.target.value))}
                                            min="0.1"
                                            step="0.1"
                                        />
                                        <input
                                            type="number"
                                            className="price-input"
                                            value={item.unit_price}
                                            onChange={(e) => updateItem(item.item_id, 'unit_price', e.target.value === '' ? '' : Number(e.target.value))}
                                            min="0"
                                            step="0.01"
                                        />
                                        <div className="item-total">£{lineTotal.toFixed(2)}</div>
                                        <button className="po-remove-btn" onClick={() => removeItem(item.item_id)} title="Remove">
                                            <MdClose />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            {/* Summary & Submit */}
            {selectedItems.length > 0 && (
                <div className="po-summary">
                    <div className="po-summary-row">
                        <span>Total Items</span>
                        <span>{selectedItems.length}</span>
                    </div>
                    <div className="po-summary-row">
                        <span>Total Quantity</span>
                        <span>{selectedItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0).toFixed(2)}</span>
                    </div>
                    <div className="po-summary-row total">
                        <span>Estimated Total</span>
                        <span>£{totalAmount.toFixed(2)}</span>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary btn-md" onClick={() => navigate('/purchase/pending')} disabled={submitting}>
                    Cancel
                </button>
                <button
                    className="btn btn-primary btn-lg"
                    onClick={handleSubmit}
                    disabled={submitting || selectedItems.length === 0}
                >
                    {submitting ? 'Creating Order...' : (
                        <>
                            <MdSend /> Place Purchase Order — £{totalAmount.toFixed(2)}
                        </>
                    )}
                </button>
            </div>

            {/* Success Modal */}
            {successOrder && (
                <div className="modal-overlay" onClick={() => { setSuccessOrder(null); navigate('/purchase/pending'); }}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
                        <div className="modal-body" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
                            {/* Company Header */}
                            <div style={{
                                background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                                borderRadius: 'var(--radius-lg)',
                                padding: 'var(--space-4)',
                                marginBottom: 'var(--space-5)',
                                color: '#fff',
                                textAlign: 'left',
                            }}>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{COMPANY.name}</h3>
                                <p style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 'var(--text-xs)' }}>{COMPANY.address}</p>
                            </div>

                            <div style={{ marginBottom: 'var(--space-4)' }}>
                                <MdCheckCircle style={{ fontSize: 56, color: '#22c55e', marginBottom: 'var(--space-2)' }} />
                                <h2 style={{ margin: '0 0 var(--space-2)', fontSize: '1.3rem' }}>Order Placed Successfully!</h2>
                                <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
                                    Your purchase order <strong style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono, monospace)' }}>{successOrder.po_number}</strong> has been created.
                                </p>
                            </div>

                            <div style={{
                                background: 'var(--color-bg)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-4)',
                                marginBottom: 'var(--space-5)',
                                textAlign: 'left',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 'var(--text-sm)' }}>
                                    <span style={{ color: 'var(--color-text-muted)' }}>Vendor</span>
                                    <span style={{ fontWeight: 600 }}>{successOrder.vendor || '—'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 'var(--text-sm)' }}>
                                    <span style={{ color: 'var(--color-text-muted)' }}>Items</span>
                                    <span style={{ fontWeight: 600 }}>{successOrder.items?.length || 0}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                                    <span style={{ color: 'var(--color-text-muted)' }}>Total</span>
                                    <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: 'var(--text-md)' }}>£{(successOrder.total_amount || 0).toFixed(2)}</span>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
                                <button
                                    className="btn btn-primary btn-md"
                                    onClick={() => generatePOPdf(successOrder)}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                >
                                    <MdPictureAsPdf /> Download PDF
                                </button>
                                <button
                                    className="btn btn-secondary btn-md"
                                    onClick={() => { setSuccessOrder(null); navigate('/purchase/pending'); }}
                                >
                                    Go to Orders
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreatePurchaseOrder;
