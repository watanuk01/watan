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
    MdCropFree,
} from 'react-icons/md';
import { createButcherPurchaseOrder } from '../../services/butcheringService';
import { getPurchaseOrders, getUniqueVendors } from '../../services/purchaseService';
import { getItems } from '../../services/inventoryService';
import toast from 'react-hot-toast';
import './ButcheringModule.css';

const safeNum = (v, fallback = 0) => { const n = Number(v); return isNaN(n) ? fallback : n; };
const safeDate = (val) => {
    if (!val) return '—';
    if (typeof val === 'string') return val;
    if (val instanceof Date) return val.toLocaleDateString('en-GB');
    if (val?.seconds) return new Date(val.seconds * 1000).toLocaleDateString('en-GB');
    try { const d = new Date(val); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB'); } catch { return '—'; }
};

const sanitize = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitize);
    if (obj.seconds !== undefined && obj.nanoseconds !== undefined) {
        return new Date(obj.seconds * 1000).toLocaleDateString('en-GB');
    }
    const result = {};
    for (const key of Object.keys(obj)) { result[key] = sanitize(obj[key]); }
    return result;
};

const DEFAULT_MEAT_CATALOG = [
    'Lamb Chops',
    'Whole Lamb Carcass',
    'Side of Beef',
    'Chicken Wings',
    'Whole Chickens (Box of 10)',
    'Baby Chickens (Box of 20)',
    'Prawns',
    'Whole Goat Carcass',
    'Mutton Fillet',
    'Beef Rump',
];

let _idCounter = 1;
const newId = () => String(_idCounter++);

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

// Calculate default 6-month expiry date
const getDefaultExpiryStr = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().substring(0, 10);
};

// Generate live batch number for an item row (e.g. LMB260618121)
const buildLiveBatchNo = (itemName, idx) => {
    const code = (itemName || 'MEAT').replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase();
    const dateStr = new Date().toISOString().substring(2, 10).replace(/-/g, '');
    const seq = String(idx + 121);
    return `${code}${dateStr}${seq}`;
};

const ButcherPurchaseOrder = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [history, setHistory] = useState([]);
    const [catalog, setCatalog] = useState(DEFAULT_MEAT_CATALOG);
    const [vendors, setVendors] = useState(['ABC Meat Suppliers', 'Al-Safa Premium Meats Ltd', 'Halal Quality Poultry Wholesalers']);
    const [vendor, setVendor] = useState('ABC Meat Suppliers');
    const [isCustomVendor, setIsCustomVendor] = useState(false);
    const [customVendor, setCustomVendor] = useState('');
    const [invoiceNo, setInvoiceNo] = useState(generateAutoInvoiceNo());
    const [invoiceDate, setInvoiceDate] = useState(getTodayDateStr());
    const [receiveDate, setReceiveDate] = useState(getTodayDateStr());
    const [receiveTime, setReceiveTime] = useState(getCurrentTimeStr());
    const [notes, setNotes] = useState('');

    const [items, setItems] = useState([
        {
            id: newId(),
            item_name: 'Lamb Chops',
            is_custom: false,
            custom_name: '',
            quantity: 5,
            weight_kg: 90,
            unit_price: 800,
            expiry_date: getDefaultExpiryStr(),
            shelf_life_days: 180,
        },
    ]);

    const loadData = async () => {
        setLoading(true);
        try {
            // 1. Load active inventory items for catalog
            const invItems = await getItems({ status: 'active' }).catch(() => []);
            if (invItems.length > 0) {
                const fetchedNames = invItems.map(i => i.name);
                const combined = [...new Set([...fetchedNames, ...DEFAULT_MEAT_CATALOG])].sort();
                setCatalog(combined);
            }

            // 2. Load unique vendors from Firestore
            const vList = await getUniqueVendors().catch(() => []);
            if (vList.length > 0) {
                const mergedVendors = [...new Set([...vList, 'ABC Meat Suppliers', 'Al-Safa Premium Meats Ltd', 'Halal Quality Poultry Wholesalers', 'London Prime Butchering Supplies'])].sort();
                setVendors(mergedVendors);
                if (!mergedVendors.includes(vendor)) setVendor(mergedVendors[0]);
            }

            // 3. Load purchase history
            const allPos = (await getPurchaseOrders().catch(() => [])).map(sanitize);
            setHistory(allPos.filter(po => po.is_butcher_po || (po.notes || '').toLowerCase().includes('meat')));
        } catch (err) {
            console.error('Error loading delivery data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    const addItem = () => {
        const defaultItem = catalog[0] || 'Lamb Chops';
        setItems(p => [
            ...p,
            {
                id: newId(),
                item_name: defaultItem,
                is_custom: false,
                custom_name: '',
                quantity: 1,
                weight_kg: 10,
                unit_price: 50,
                expiry_date: getDefaultExpiryStr(),
                shelf_life_days: 180,
            },
        ]);
    };

    const removeItem = (id) => {
        if (items.length <= 1) { toast.error('At least one item is required'); return; }
        setItems(p => p.filter(i => i.id !== id));
    };

    const updateItem = (id, field, value) => {
        setItems(p => p.map(i => {
            if (i.id !== id) return i;
            if (field === 'item_name') {
                if (value === '__CUSTOM__') {
                    return { ...i, is_custom: true, item_name: '' };
                }
                return { ...i, is_custom: false, item_name: value };
            }
            return { ...i, [field]: value };
        }));
    };

    // Calculate totals matching Screenshot 2
    const totalWeightKg = items.reduce((s, i) => s + safeNum(i.weight_kg), 0);
    const grandTotalValue = items.reduce((s, i) => s + (safeNum(i.weight_kg) * safeNum(i.unit_price)), 0);

    const handleSubmit = async () => {
        const finalVendor = isCustomVendor ? customVendor.trim() : vendor;
        if (!finalVendor) { toast.error('Please select or enter a vendor'); return; }
        if (!invoiceNo) { toast.error('Please enter an invoice number'); return; }
        
        const invalidItem = items.find(i => (i.is_custom ? !i.custom_name.trim() : !i.item_name) || safeNum(i.weight_kg) <= 0);
        if (invalidItem) {
            toast.error('All items must have a valid name and weight > 0 kg');
            return;
        }

        setSaving(true);
        try {
            const formattedItems = items.map((i, idx) => {
                const finalName = i.is_custom ? i.custom_name.trim() : i.item_name;
                const batchNo = buildLiveBatchNo(finalName, idx);
                return {
                    item_name: finalName,
                    quantity: safeNum(i.quantity, 1),
                    weight_kg: safeNum(i.weight_kg),
                    unit_price: safeNum(i.unit_price),
                    total_value: safeNum(i.weight_kg) * safeNum(i.unit_price),
                    expiry_date: i.expiry_date,
                    shelf_life_days: safeNum(i.shelf_life_days, 180),
                    batch_number: batchNo,
                };
            });

            const poData = {
                vendor: finalVendor,
                invoice_no: invoiceNo,
                invoice_date: invoiceDate,
                receive_date: receiveDate,
                receive_time: receiveTime,
                notes: notes || 'Meat Vendor Delivery Received',
                items: formattedItems,
            };

            const result = await createButcherPurchaseOrder(poData);
            toast.success(`Vendor delivery saved! ${result.createdBatches?.length || 0} parent batches created in inventory.`);
            loadData();
            setNotes('');
            setIsCustomVendor(false);
            setCustomVendor('');
        } catch (err) {
            toast.error('Save failed: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

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
                        Order whole animals and raw meat from certified Halal suppliers for butchering
                    </p>
                </div>
            </div>

            {/* Section 1: Vendor & Invoice Details (Full Width) */}
            <div className="butcher-panel" style={{ marginBottom: 24 }}>
                <h3 className="butcher-panel-title" style={{ color: 'var(--color-primary)', marginBottom: 16 }}>
                    1. Vendor &amp; Invoice Details
                </h3>

                <div className="vendor-invoice-grid">
                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6, display: 'block' }}>
                            VENDOR <span style={{ color: 'var(--color-danger)' }}>*</span>
                        </label>
                        {isCustomVendor ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                                <input
                                    type="text"
                                    className="form-input"
                                    style={{ flex: 1 }}
                                    placeholder="Enter vendor name..."
                                    value={customVendor}
                                    onChange={e => setCustomVendor(e.target.value)}
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
                                style={{ width: '100%' }}
                                value={vendor}
                                onChange={e => {
                                    if (e.target.value === '__CUSTOM_VENDOR__') {
                                        setIsCustomVendor(true);
                                    } else {
                                        setVendor(e.target.value);
                                    }
                                }}
                            >
                                {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                                <option value="__CUSTOM_VENDOR__">+ Enter New Vendor Name...</option>
                            </select>
                        )}
                    </div>

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6, display: 'block' }}>
                            INVOICE NO <span style={{ color: 'var(--color-danger)' }}>*</span>
                        </label>
                        <input
                            type="text"
                            className="form-input"
                            style={{ width: '100%' }}
                            value={invoiceNo}
                            onChange={e => setInvoiceNo(e.target.value)}
                            placeholder="INV-2026-0618"
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6, display: 'block' }}>
                            INVOICE DATE
                        </label>
                        <input
                            type="date"
                            className="form-input"
                            style={{ width: '100%' }}
                            value={invoiceDate}
                            onChange={e => setInvoiceDate(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6, display: 'block' }}>
                            RECEIVE DATE
                        </label>
                        <input
                            type="date"
                            className="form-input"
                            style={{ width: '100%' }}
                            value={receiveDate}
                            onChange={e => setReceiveDate(e.target.value)}
                        />
                    </div>
                </div>

                <div className="vendor-invoice-row-2" style={{ marginTop: 16 }}>
                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6, display: 'block' }}>
                            RECEIVE TIME
                        </label>
                        <input
                            type="time"
                            className="form-input"
                            style={{ width: '100%' }}
                            value={receiveTime}
                            onChange={e => setReceiveTime(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6, display: 'block' }}>
                            NOTES / REMARKS
                        </label>
                        <input
                            type="text"
                            className="form-input"
                            style={{ width: '100%' }}
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Vehicle no, driver name, remarks..."
                        />
                    </div>
                </div>
            </div>

            {/* Section 2: Received Items (Full Width - Matching Screenshot 2) */}
            <div className="butcher-panel" style={{ marginBottom: 24 }}>
                <div className="butcher-panel-header">
                    <h3 className="butcher-panel-title">Received Items ({items.length})</h3>
                    <button className="btn btn-secondary btn-sm" onClick={addItem}><MdAdd /> Add Item</button>
                </div>

                <div className="butcher-table-wrap">
                    <table className="butcher-table">
                        <thead>
                            <tr>
                                <th style={{ width: '22%' }}>PRODUCT</th>
                                <th style={{ width: '10%' }}>QTY</th>
                                <th style={{ width: '13%' }}>WEIGHT (KG)</th>
                                <th style={{ width: '15%' }}>UNIT PRICE (£)</th>
                                <th style={{ width: '16%' }}>EXPIRY DATE</th>
                                <th style={{ width: '10%' }}>SHELF LIFE</th>
                                <th style={{ width: '14%' }}>BATCH / QR</th>
                                <th style={{ width: 40 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, idx) => {
                                const finalName = item.is_custom ? (item.custom_name || 'Custom Item') : item.item_name;
                                const liveBatchNo = buildLiveBatchNo(finalName, idx);
                                const itemValue = safeNum(item.weight_kg) * safeNum(item.unit_price);

                                return (
                                    <tr key={item.id}>
                                        <td>
                                            {item.is_custom ? (
                                                <div style={{ display: 'flex', gap: 6 }}>
                                                    <input
                                                        type="text"
                                                        className="table-cell-input"
                                                        style={{ flex: 1 }}
                                                        placeholder="Enter product name..."
                                                        value={item.custom_name}
                                                        onChange={e => updateItem(item.id, 'custom_name', e.target.value)}
                                                    />
                                                    <button
                                                        type="button"
                                                        className="btn-text-link"
                                                        style={{ fontSize: 11 }}
                                                        onClick={() => updateItem(item.id, 'item_name', catalog[0] || 'Lamb Chops')}
                                                    >
                                                        Catalog
                                                    </button>
                                                </div>
                                            ) : (
                                                <select
                                                    className="table-cell-select"
                                                    style={{ width: '100%' }}
                                                    value={item.item_name}
                                                    onChange={e => updateItem(item.id, 'item_name', e.target.value)}
                                                >
                                                    {catalog.map(c => <option key={c} value={c}>{c}</option>)}
                                                    <option value="__CUSTOM__">+ Type Custom Product...</option>
                                                </select>
                                            )}
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                min="1"
                                                step="1"
                                                className="table-cell-input"
                                                style={{ width: '100%' }}
                                                value={item.quantity}
                                                onChange={e => updateItem(item.id, 'quantity', e.target.value)}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                min="0.1"
                                                step="0.1"
                                                className="table-cell-input"
                                                style={{ width: '100%' }}
                                                value={item.weight_kg}
                                                onChange={e => updateItem(item.id, 'weight_kg', e.target.value)}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                className="table-cell-input"
                                                style={{ width: '100%' }}
                                                value={item.unit_price}
                                                onChange={e => updateItem(item.id, 'unit_price', e.target.value)}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="date"
                                                className="table-cell-input"
                                                style={{ width: '100%' }}
                                                value={item.expiry_date}
                                                onChange={e => updateItem(item.id, 'expiry_date', e.target.value)}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                min="1"
                                                className="table-cell-input"
                                                style={{ width: '100%' }}
                                                value={item.shelf_life_days}
                                                onChange={e => updateItem(item.id, 'shelf_life_days', e.target.value)}
                                            />
                                        </td>
                                        <td>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', display: 'flex', flexDirection: 'column' }}>
                                                <span>{liveBatchNo}</span>
                                                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>£{itemValue.toLocaleString()}</span>
                                            </div>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <button className="btn-icon-danger" onClick={() => removeItem(item.id)} title="Remove"><MdDelete size={14} /></button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Batch Generation Preview & Receipt Summary Cards (Matching Screenshot 2) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24 }}>
                    {/* Left Box: Batch Generation Preview */}
                    <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                        <h4 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
                            BATCH GENERATION PREVIEW
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {items.map((i, idx) => {
                                const finalName = i.is_custom ? (i.custom_name || 'Custom Item') : i.item_name;
                                const batchNo = buildLiveBatchNo(finalName, idx);
                                return (
                                    <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
                                        <div>
                                            <span className="batch-code" style={{ marginRight: 8 }}>{batchNo}</span>
                                            <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{finalName}</span>
                                        </div>
                                        <div style={{ fontWeight: 700, color: 'var(--color-success)' }}>
                                            {safeNum(i.weight_kg)} Kg
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right Box: Receipt Summary */}
                    <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                        <h4 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
                            RECEIPT SUMMARY
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 6 }}>
                                <span style={{ color: 'var(--color-text-secondary)' }}>Total Items</span>
                                <span style={{ fontWeight: 600 }}>{items.length}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 6 }}>
                                <span style={{ color: 'var(--color-text-secondary)' }}>Total Weight</span>
                                <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>{totalWeightKg.toFixed(2)} Kg</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 2 }}>
                                <span style={{ color: 'var(--color-text-secondary)' }}>Total Value</span>
                                <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: 15 }}>£{grandTotalValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                        <strong>{items.length} item(s)</strong> • <strong style={{ color: 'var(--color-success)' }}>{totalWeightKg.toFixed(2)} Kg</strong> • <strong style={{ color: 'var(--color-primary)' }}>£{grandTotalValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button className="btn btn-secondary btn-md" onClick={() => navigate('/butchering/dashboard')}>Cancel</button>
                        <button className="btn btn-primary btn-md" onClick={handleSubmit} disabled={saving} style={{ background: 'var(--color-primary)', color: '#000', fontWeight: 700 }}>
                            <MdSave /> {saving ? 'Creating Batches...' : 'Save & Create Batches'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Section 3: Purchase History (Full Width) */}
            <div className="butcher-panel">
                <div className="butcher-panel-header">
                    <h3 className="butcher-panel-title"><MdReceipt /> 3. Meat Purchase Orders History</h3>
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
                                    <th>TOTAL (£)</th>
                                    <th>STATUS</th>
                                    <th>DATE</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map(po => (
                                    <tr key={po.id}>
                                        <td><span className="batch-code">{po.po_number}</span></td>
                                        <td style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{po.vendor || '—'}</td>
                                        <td style={{ fontWeight: 600 }}>£{safeNum(po.total_amount).toFixed(2)}</td>
                                        <td>
                                            <span className={`chip-${po.status === 'received' ? 'green' : po.status === 'cancelled' ? 'red' : 'amber'}`}>
                                                {po.status || 'pending'}
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{safeDate(po.created_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ButcherPurchaseOrder;
