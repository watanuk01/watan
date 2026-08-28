import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MdShoppingCart,
    MdAdd,
    MdDelete,
    MdSave,
    MdArrowBack,
    MdReceipt,
    MdRefresh,
    MdHistory,
    MdCheckCircle,
    MdPictureAsPdf,
    MdEmail,
    MdLocalShipping,
} from 'react-icons/md';
import {
    createButcherPurchaseOrder,
    getButcherPurchaseOrders,
    receiveButcherPO,
    getAnimals,
} from '../../services/butcheringService';
import { getUniqueVendors } from '../../services/purchaseService';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import './ButcheringModule.css';

const safeNum = (v, fallback = 0) => { const n = Number(v); return isNaN(n) ? fallback : n; };
const safeDate = (val) => {
    if (!val) return '—';
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return new Date(val).toLocaleDateString('en-GB');
    if (val instanceof Date) return val.toLocaleDateString('en-GB');
    if (typeof val === 'object') {
        if (val.seconds !== undefined && typeof val.seconds === 'number') {
            return new Date(val.seconds * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        }
        if (typeof val.toDate === 'function') {
            return val.toDate().toLocaleDateString('en-GB');
        }
        return '—';
    }
    return String(val);
};

let _idCounter = 1;
const newId = () => String(_idCounter++);

const ButcherPurchaseOrder = () => {
    const navigate = useNavigate();
    const [tab, setTab] = useState('new'); // 'new' | 'history'

    // ── Form State ──
    const [saving, setSaving] = useState(false);
    const [animals, setAnimals] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [vendor, setVendor] = useState('');
    const [isCustomVendor, setIsCustomVendor] = useState(false);
    const [customVendor, setCustomVendor] = useState('');
    const [notes, setNotes] = useState('');
    const [items, setItems] = useState([]);

    // ── History State ──
    const [loading, setLoading] = useState(true);
    const [history, setHistory] = useState([]);
    const [detailPO, setDetailPO] = useState(null);
    const [receiving, setReceiving] = useState(null);

    // ── Build product catalog from animals ──
    const productCatalog = animals.map(a => ({
        id: a.id,
        name: a.name,
        animal_type: a.animal_type,
        base_weight: a.base_weight,
        base_unit: a.base_unit,
    }));

    // ── Load data ──
    const loadData = async () => {
        setLoading(true);
        try {
            const [animalList, vList, poList] = await Promise.all([
                getAnimals().catch(() => []),
                getUniqueVendors().catch(() => []),
                getButcherPurchaseOrders().catch(() => []),
            ]);

            setAnimals(animalList || []);

            const defaultVendors = ['ABC Meat Suppliers', 'Al-Safa Premium Meats Ltd'];
            const merged = [...new Set([...(vList || []), ...defaultVendors])].sort();
            setVendors(merged);
            if (!vendor && merged.length > 0) setVendor(merged[0]);

            setHistory(poList || []);

            // Initialize first item row if empty
            if (items.length === 0 && animalList.length > 0) {
                setItems([{
                    id: newId(),
                    item_name: animalList[0]?.name || 'Meat',
                    animal_id: animalList[0]?.id || '',
                    quantity: 1,
                    unit_price: 0,
                }]);
            }
        } catch (err) {
            console.error('Error loading data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Item CRUD ──
    const addItem = () => {
        const defaultProduct = productCatalog[0];
        setItems(p => [...p, {
            id: newId(),
            item_name: defaultProduct?.name || 'Meat',
            animal_id: defaultProduct?.id || '',
            quantity: 1,
            unit_price: 0,
        }]);
    };

    const removeItem = (id) => {
        if (items.length <= 1) { toast.error('At least one item is required'); return; }
        setItems(p => p.filter(i => i.id !== id));
    };

    const updateItem = (id, field, value) => {
        setItems(p => p.map(i => {
            if (i.id !== id) return i;
            if (field === 'item_name') {
                const animal = productCatalog.find(a => a.name === value);
                return { ...i, item_name: value, animal_id: animal?.id || '' };
            }
            return { ...i, [field]: value };
        }));
    };

    // ── Totals ──
    const totalQty = items.reduce((s, i) => s + safeNum(i.quantity), 0);
    const grandTotal = items.reduce((s, i) => s + (safeNum(i.quantity) * safeNum(i.unit_price)), 0);

    // ── Submit ──
    const handleSubmit = async () => {
        const finalVendor = isCustomVendor ? customVendor.trim() : vendor;
        if (!finalVendor) { toast.error('Please select or enter a vendor'); return; }

        const invalidItem = items.find(i => !i.item_name || safeNum(i.quantity) <= 0);
        if (invalidItem) { toast.error('All items must have a valid name and quantity > 0'); return; }

        setSaving(true);
        try {
            const formattedItems = items.map(i => ({
                item_name: i.item_name,
                animal_id: i.animal_id || '',
                quantity: safeNum(i.quantity),
                unit_price: safeNum(i.unit_price),
            }));

            await createButcherPurchaseOrder({
                vendor: finalVendor,
                notes: notes || '',
                items: formattedItems,
            });

            toast.success('Meat Purchase Order created!');
            setNotes('');
            setItems([{
                id: newId(),
                item_name: productCatalog[0]?.name || 'Meat',
                animal_id: productCatalog[0]?.id || '',
                quantity: 1,
                unit_price: 0,
            }]);
            loadData();
            setTab('history');
        } catch (err) {
            toast.error('Save failed: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    // ── Mark Received ──
    const handleReceive = async (poId) => {
        if (!window.confirm('Mark this order as received? This will create inventory batches.')) return;
        setReceiving(poId);
        try {
            const result = await receiveButcherPO(poId);
            toast.success(`Order received! ${result.createdBatches?.length || 0} batches created.`);
            loadData();
        } catch (err) {
            toast.error('Failed: ' + err.message);
        } finally {
            setReceiving(null);
        }
    };

    // ── PDF Download ──
    const downloadPDF = (po) => {
        const pdf = new jsPDF();
        const items = po.items || [];

        pdf.setFontSize(18);
        pdf.text('Meat Purchase Order', 14, 22);

        pdf.setFontSize(10);
        pdf.text(`PO#: ${po.po_number || '—'}`, 14, 35);
        pdf.text(`Vendor: ${po.vendor || po.vendor_name || '—'}`, 14, 42);
        pdf.text(`Date: ${safeDate(po.created_at)}`, 14, 49);
        pdf.text(`Status: ${po.status || '—'}`, 14, 56);

        // Table headers
        let y = 68;
        pdf.setFontSize(9);
        pdf.setFont(undefined, 'bold');
        pdf.text('Product', 14, y);
        pdf.text('Qty', 90, y);
        pdf.text('Unit Price (£)', 110, y);
        pdf.text('Purchase Price (£)', 150, y);
        y += 4;
        pdf.line(14, y, 196, y);
        y += 6;

        pdf.setFont(undefined, 'normal');
        items.forEach(item => {
            pdf.text(item.item_name || '—', 14, y);
            pdf.text(String(item.quantity || 0), 90, y);
            pdf.text(`£${(item.unit_price || 0).toFixed(2)}`, 110, y);
            pdf.text(`£${(item.purchase_price || (item.quantity * item.unit_price) || 0).toFixed(2)}`, 150, y);
            y += 7;
        });

        y += 4;
        pdf.line(14, y, 196, y);
        y += 8;
        pdf.setFont(undefined, 'bold');
        pdf.text(`Total Qty: ${po.total_quantity || 0}`, 14, y);
        pdf.text(`Total: £${(po.total_amount || 0).toFixed(2)}`, 110, y);

        if (po.notes) {
            y += 12;
            pdf.setFont(undefined, 'normal');
            pdf.text(`Notes: ${po.notes}`, 14, y);
        }

        pdf.save(`${po.po_number || 'MPO'}.pdf`);
    };

    // ── Email ──
    const emailOrder = (po) => {
        const items = po.items || [];
        const itemLines = items.map(i =>
            `  - ${i.item_name}: Qty ${i.quantity} × £${(i.unit_price || 0).toFixed(2)} = £${(i.purchase_price || (i.quantity * i.unit_price) || 0).toFixed(2)}`
        ).join('%0A');

        const subject = `Meat Purchase Order ${po.po_number}`;
        const body = `Meat Purchase Order%0A%0APO#: ${po.po_number}%0AVendor: ${po.vendor || '—'}%0ADate: ${safeDate(po.created_at)}%0AStatus: ${po.status}%0A%0AItems:%0A${itemLines}%0A%0ATotal: £${(po.total_amount || 0).toFixed(2)}%0A%0ANotes: ${po.notes || '—'}`;

        window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${body}`);
    };

    // ═══════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════
    return (
        <div className="butcher-page">
            <div className="butcher-page-header">
                <div>
                    <button className="btn-back" onClick={() => navigate('/butchering/dashboard')}>
                        <MdArrowBack /> Back to Dashboard
                    </button>
                    <h1 className="butcher-page-title" style={{ marginTop: 6 }}>
                        <MdShoppingCart className="title-icon" /> Meat Purchase Order
                    </h1>
                    <p className="butcher-page-subtitle">
                        Order whole animals and raw meat from certified Halal suppliers
                    </p>
                </div>
            </div>

            {/* Tab Bar */}
            <div style={{
                display: 'flex', gap: 4, background: 'var(--color-bg-dark)',
                borderRadius: 'var(--radius-lg)', padding: 4, marginBottom: 'var(--space-5)',
                width: 'fit-content',
            }}>
                {[
                    { key: 'new', label: 'New Order', icon: <MdAdd /> },
                    { key: 'history', label: 'Order History', icon: <MdHistory /> },
                ].map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '10px 20px', borderRadius: 'var(--radius-md)',
                            border: 'none', cursor: 'pointer', fontSize: 'var(--text-sm)',
                            fontWeight: 600, transition: 'all 0.2s',
                            background: tab === t.key ? 'var(--color-primary)' : 'transparent',
                            color: tab === t.key ? 'var(--color-bg-dark)' : 'var(--color-text-muted)',
                        }}
                    >
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            {/* ═══════════════════════════════════════════
                TAB: NEW ORDER
            ═══════════════════════════════════════════ */}
            {tab === 'new' && (
                <>
                    {/* Vendor Details */}
                    <div className="butcher-panel" style={{ marginBottom: 24 }}>
                        <h3 className="butcher-panel-title" style={{ color: 'var(--color-primary)', marginBottom: 16 }}>
                            1. Vendor Details
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <div className="form-group">
                                <label className="form-label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6, display: 'block' }}>
                                    VENDOR <span style={{ color: 'var(--color-danger)' }}>*</span>
                                </label>
                                {isCustomVendor ? (
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <input type="text" className="form-input" style={{ flex: 1 }} placeholder="Enter vendor name..."
                                            value={customVendor} onChange={e => setCustomVendor(e.target.value)} />
                                        <button type="button" className="btn-text-link" style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                                            onClick={() => setIsCustomVendor(false)}>Select List</button>
                                    </div>
                                ) : (
                                    <select className="form-input" style={{ width: '100%' }} value={vendor}
                                        onChange={e => {
                                            if (e.target.value === '__CUSTOM__') setIsCustomVendor(true);
                                            else setVendor(e.target.value);
                                        }}>
                                        {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                                        <option value="__CUSTOM__">+ Enter New Vendor Name...</option>
                                    </select>
                                )}
                            </div>
                            <div className="form-group">
                                <label className="form-label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6, display: 'block' }}>
                                    NOTES / REMARKS
                                </label>
                                <input type="text" className="form-input" style={{ width: '100%' }}
                                    value={notes} onChange={e => setNotes(e.target.value)}
                                    placeholder="Vehicle no, driver name, remarks..." />
                            </div>
                        </div>
                    </div>

                    {/* Items Table */}
                    <div className="butcher-panel" style={{ marginBottom: 24 }}>
                        <div className="butcher-panel-header">
                            <h3 className="butcher-panel-title">2. Order Items ({items.length})</h3>
                            <button className="btn btn-secondary btn-sm" onClick={addItem}><MdAdd /> Add Item</button>
                        </div>

                        <div className="butcher-table-wrap">
                            <table className="butcher-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '30%' }}>PRODUCT</th>
                                        <th style={{ width: '15%' }}>QUANTITY (kg)</th>
                                        <th style={{ width: '15%' }}>UNIT PRICE (£)</th>
                                        <th style={{ width: '18%' }}>PURCHASE PRICE (£)</th>
                                        <th style={{ width: 40 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map(item => {
                                        const purchasePrice = safeNum(item.quantity) * safeNum(item.unit_price);
                                        return (
                                            <tr key={item.id}>
                                                <td>
                                                    <select className="table-cell-select" style={{ width: '100%' }}
                                                        value={item.item_name}
                                                        onChange={e => updateItem(item.id, 'item_name', e.target.value)}>
                                                        {productCatalog.map(p => (
                                                            <option key={p.id} value={p.name}>
                                                                {p.name} ({p.animal_type})
                                                            </option>
                                                        ))}
                                                        {productCatalog.length === 0 && (
                                                            <option value="">No products — add in Cut Types Admin</option>
                                                        )}
                                                    </select>
                                                </td>
                                                <td>
                                                    <input type="number" min="0.1" step="0.1" className="table-cell-input"
                                                        style={{ width: '100%' }} value={item.quantity}
                                                        onChange={e => updateItem(item.id, 'quantity', e.target.value)} />
                                                </td>
                                                <td>
                                                    <input type="number" step="0.01" min="0" className="table-cell-input"
                                                        style={{ width: '100%' }} value={item.unit_price}
                                                        onChange={e => updateItem(item.id, 'unit_price', e.target.value)} />
                                                </td>
                                                <td>
                                                    <div style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: 14, padding: '8px 12px' }}>
                                                        £{purchasePrice.toFixed(2)}
                                                    </div>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <button className="btn-icon-danger" onClick={() => removeItem(item.id)} title="Remove">
                                                        <MdDelete size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Summary */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24 }}>
                            <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                                <h4 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
                                    ORDER SUMMARY
                                </h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 6 }}>
                                        <span style={{ color: 'var(--color-text-secondary)' }}>Total Items</span>
                                        <span style={{ fontWeight: 600 }}>{items.length}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 6 }}>
                                        <span style={{ color: 'var(--color-text-secondary)' }}>Total Quantity</span>
                                        <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>{totalQty.toFixed(1)} kg</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 2 }}>
                                        <span style={{ color: 'var(--color-text-secondary)' }}>Total Amount</span>
                                        <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: 15 }}>£{grandTotal.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Submit Bar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                                <strong>{items.length} item(s)</strong> •{' '}
                                <strong style={{ color: 'var(--color-success)' }}>{totalQty.toFixed(1)} kg</strong> •{' '}
                                <strong style={{ color: 'var(--color-primary)' }}>£{grandTotal.toFixed(2)}</strong>
                            </div>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <button className="btn btn-secondary btn-md" onClick={() => navigate('/butchering/dashboard')}>Cancel</button>
                                <button className="btn btn-primary btn-md" onClick={handleSubmit} disabled={saving}
                                    style={{ background: 'var(--color-primary)', color: '#000', fontWeight: 700 }}>
                                    <MdSave /> {saving ? 'Creating Order...' : 'Place Order'}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* ═══════════════════════════════════════════
                TAB: ORDER HISTORY
            ═══════════════════════════════════════════ */}
            {tab === 'history' && (
                <div className="butcher-panel">
                    <div className="butcher-panel-header">
                        <h3 className="butcher-panel-title"><MdReceipt /> Meat Purchase Orders History</h3>
                        <button className="btn-text-link" onClick={loadData}><MdRefresh /> Refresh</button>
                    </div>
                    {loading ? (
                        <div className="butcher-loading">Loading orders...</div>
                    ) : history.length === 0 ? (
                        <div className="butcher-empty"><p>No meat purchase orders found.</p></div>
                    ) : (
                        <div className="butcher-table-wrap">
                            <table className="butcher-table">
                                <thead>
                                    <tr>
                                        <th>PO NUMBER</th>
                                        <th>VENDOR</th>
                                        <th>ITEMS</th>
                                        <th>TOTAL QTY</th>
                                        <th>TOTAL (£)</th>
                                        <th>STATUS</th>
                                        <th>DATE</th>
                                        <th style={{ width: 180 }}>ACTIONS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map(po => (
                                        <tr key={po.id} onClick={() => setDetailPO(po)} style={{ cursor: 'pointer' }}>
                                            <td><span className="batch-code">{po.po_number}</span></td>
                                            <td style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{po.vendor || '—'}</td>
                                            <td>{(po.items || []).length}</td>
                                            <td style={{ fontWeight: 600 }}>{safeNum(po.total_quantity).toFixed(1)} kg</td>
                                            <td style={{ fontWeight: 600 }}>£{safeNum(po.total_amount).toFixed(2)}</td>
                                            <td>
                                                <span className={`chip-${po.status === 'received' ? 'green' : po.status === 'ordered' ? 'amber' : 'red'}`}>
                                                    {po.status === 'ordered' ? '📦 Ordered' : po.status === 'received' ? '✅ Received' : po.status || 'pending'}
                                                </span>
                                            </td>
                                            <td style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{safeDate(po.created_at)}</td>
                                            <td onClick={e => e.stopPropagation()}>
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    {po.status === 'ordered' && (
                                                        <button
                                                            className="btn btn-sm"
                                                            style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontSize: 11 }}
                                                            onClick={() => handleReceive(po.id)}
                                                            disabled={receiving === po.id}
                                                        >
                                                            <MdLocalShipping size={12} /> {receiving === po.id ? '...' : 'Received'}
                                                        </button>
                                                    )}
                                                    <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                                                        onClick={() => downloadPDF(po)} title="Download PDF">
                                                        <MdPictureAsPdf size={12} /> PDF
                                                    </button>
                                                    <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                                                        onClick={() => emailOrder(po)} title="Email Order">
                                                        <MdEmail size={12} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ═══════════════════════════════════════════
                DETAIL MODAL
            ═══════════════════════════════════════════ */}
            {detailPO && (
                <div className="butcher-modal-overlay" onClick={() => setDetailPO(null)}>
                    <div className="butcher-modal" style={{ maxWidth: 640, maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-head">
                            <h2><MdReceipt /> {detailPO.po_number}</h2>
                            <button className="modal-close" onClick={() => setDetailPO(null)}>✕</button>
                        </div>
                        <div className="modal-body-scroll" style={{ maxHeight: 'calc(90vh - 130px)' }}>
                            {/* Meta */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                                <div>
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Vendor</div>
                                    <div style={{ fontWeight: 600 }}>{detailPO.vendor || '—'}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</div>
                                    <span className={`chip-${detailPO.status === 'received' ? 'green' : 'amber'}`}>
                                        {detailPO.status === 'ordered' ? '📦 Ordered' : '✅ Received'}
                                    </span>
                                </div>
                                <div>
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date</div>
                                    <div style={{ fontWeight: 600 }}>{safeDate(detailPO.created_at)}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</div>
                                    <div style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: 18 }}>£{safeNum(detailPO.total_amount).toFixed(2)}</div>
                                </div>
                            </div>

                            {detailPO.notes && (
                                <div style={{ padding: 12, background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', marginBottom: 16, fontSize: 13, borderLeft: '3px solid var(--color-primary)' }}>
                                    📝 {detailPO.notes}
                                </div>
                            )}

                            {/* Items */}
                            <table className="butcher-table" style={{ width: '100%' }}>
                                <thead>
                                    <tr>
                                        <th>Product</th>
                                        <th>Qty</th>
                                        <th>Unit Price</th>
                                        <th>Purchase Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(detailPO.items || []).map((item, idx) => (
                                        <tr key={idx}>
                                            <td style={{ fontWeight: 600 }}>{item.item_name}</td>
                                            <td>{item.quantity} kg</td>
                                            <td>£{safeNum(item.unit_price).toFixed(2)}</td>
                                            <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                                                £{safeNum(item.purchase_price || (item.quantity * item.unit_price)).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="modal-foot">
                            {detailPO.status === 'ordered' && (
                                <button className="btn btn-primary btn-md" onClick={() => { handleReceive(detailPO.id); setDetailPO(null); }}>
                                    <MdCheckCircle /> Mark as Received
                                </button>
                            )}
                            <button className="btn btn-secondary btn-md" onClick={() => downloadPDF(detailPO)}>
                                <MdPictureAsPdf /> Download PDF
                            </button>
                            <button className="btn btn-secondary btn-md" onClick={() => emailOrder(detailPO)}>
                                <MdEmail /> Email
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ButcherPurchaseOrder;
