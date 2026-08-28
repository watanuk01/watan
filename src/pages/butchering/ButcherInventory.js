import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MdInventory2,
    MdArrowBack,
    MdRefresh,
    MdContentCut,
    MdSyncAlt,
    MdSearch,
} from 'react-icons/md';
import { getButcherInventory, getButcherCutInventory } from '../../services/butcheringService';
import MapCutToCKModal from './MapCutToCKModal';
import toast from 'react-hot-toast';
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

const ButcherInventory = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [batches, setBatches] = useState([]);
    const [cutBatches, setCutBatches] = useState([]);
    const [activeTab, setActiveTab] = useState('uncut');
    const [mappingCutBatch, setMappingCutBatch] = useState(null);
    const [cutSearchTerm, setCutSearchTerm] = useState('');

    const load = async () => {
        setLoading(true);
        try {
            const [list, cuts] = await Promise.all([getButcherInventory(), getButcherCutInventory()]);
            setBatches(list || []);
            setCutBatches(cuts || []);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load butcher inventory');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const totalWeight = batches.reduce((s, b) => s + safeNum(b.remaining_weight_kg ?? b.quantity ?? b.initial_quantity), 0);
    const totalCutWeight = cutBatches.reduce((s, b) => s + safeNum(b.remaining_qty ?? b.remaining_weight_kg ?? b.quantity), 0);
    const pendingBatches = batches.filter(b => b.butchered_status !== 'completed');

    // Filter cut batches by search term
    const filteredCutBatches = useMemo(() => {
        if (!cutSearchTerm.trim()) return cutBatches;
        const q = cutSearchTerm.toLowerCase().trim();
        return cutBatches.filter(b => 
            (b.cut_name || b.item_name || '').toLowerCase().includes(q) ||
            (b.batch_number || b.id || '').toLowerCase().includes(q) ||
            (b.parent_batch_no || '').toLowerCase().includes(q)
        );
    }, [cutBatches, cutSearchTerm]);

    return (
        <div className="butcher-page">
            <div className="butcher-page-header">
                <div>
                    <button className="btn-back" onClick={() => navigate('/butchering/dashboard')}>
                        <MdArrowBack /> Back to Dashboard
                    </button>
                    <h1 className="butcher-page-title" style={{ marginTop: 6 }}>
                        <MdInventory2 className="title-icon" /> Butcher Inventory
                    </h1>
                    <p className="butcher-page-subtitle">
                        Received uncut meat &amp; usable cut meat ready for Central Kitchen (CK) mapping
                    </p>
                </div>
                <div className="butcher-header-actions">
                    <button className="btn btn-secondary btn-md" onClick={load}><MdRefresh /> Refresh</button>
                </div>
            </div>

            {/* KPI Summary */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 'var(--space-4)', marginBottom: 'var(--space-5)',
            }}>
                {[
                    { label: 'Uncut Batches', value: batches.length, color: 'var(--color-primary)' },
                    { label: 'Uncut Weight', value: `${totalWeight.toFixed(1)} kg`, color: '#f59e0b' },
                    { label: 'Cut Meat Batches', value: cutBatches.length, color: 'var(--color-info)' },
                    { label: 'Cut Meat Available', value: `${totalCutWeight.toFixed(1)} kg`, color: '#22c55e' },
                ].map((kpi, i) => (
                    <div key={i} style={{
                        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', textAlign: 'center',
                    }}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{kpi.label}</div>
                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: kpi.color, fontFamily: 'var(--font-heading)' }}>{kpi.value}</div>
                    </div>
                ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
                <button className={`btn btn-sm ${activeTab === 'uncut' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('uncut')}>
                    <MdInventory2 /> Uncut Meat ({batches.length})
                </button>
                <button className={`btn btn-sm ${activeTab === 'cut' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('cut')}>
                    <MdContentCut /> Cut Meat ({cutBatches.length})
                </button>
            </div>

            {activeTab === 'uncut' && (
            <div className="butcher-panel">
                {loading ? (
                    <div className="butcher-loading">Loading butcher inventory...</div>
                ) : batches.length === 0 ? (
                    <div className="butcher-empty">
                        <p>No uncut meat in butcher inventory. Receive a meat purchase order first.</p>
                        <button className="btn btn-primary btn-sm" onClick={() => navigate('/butchering/purchase-order')}>
                            Go to Purchase Orders
                        </button>
                    </div>
                ) : (
                    <div className="butcher-table-wrap">
                        <table className="butcher-table">
                            <thead>
                                <tr>
                                    <th>BATCH #</th>
                                    <th>PRODUCT</th>
                                    <th>VENDOR</th>
                                    <th>QUANTITY (kg)</th>
                                    <th>RECEIVED DATE</th>
                                    <th>EXPIRY</th>
                                    <th>STATUS</th>
                                    <th style={{ width: 140 }}>ACTION</th>
                                </tr>
                            </thead>
                            <tbody>
                                {batches.map(batch => {
                                    const qty = safeNum(batch.remaining_weight_kg ?? batch.quantity ?? batch.initial_quantity);
                                    const status = batch.butchered_status || 'pending';

                                    return (
                                        <tr key={batch.id}>
                                            <td>
                                                <span className="batch-code">{batch.batch_number || batch.id?.substring(0, 10)}</span>
                                            </td>
                                            <td style={{ fontWeight: 600 }}>{batch.item_name || '—'}</td>
                                            <td style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
                                                {batch.vendor_name || batch.supplier || '—'}
                                            </td>
                                            <td style={{ fontWeight: 700, color: 'var(--color-success)' }}>
                                                {qty.toFixed(1)} kg
                                            </td>
                                            <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                {safeDate(batch.received_at || batch.created_at)}
                                            </td>
                                            <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                {safeDate(batch.expiry_date)}
                                            </td>
                                            <td>
                                                <span className={`chip-${status === 'completed' ? 'green' : status === 'partial' ? 'amber' : 'blue'}`}>
                                                    {status === 'completed' ? '✅ Butchered' : status === 'partial' ? '🔶 Partial' : '🥩 Pending'}
                                                </span>
                                            </td>
                                            <td>
                                                {status !== 'completed' && (
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => navigate(`/butchering/new?source=${batch.id}`)}
                                                    >
                                                        <MdContentCut size={12} /> Start Butchering
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            )}

            {activeTab === 'cut' && (
            <div className="butcher-panel">
                <div className="butcher-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                        <h3 className="butcher-panel-title"><MdContentCut /> Cut Meat Inventory ({cutBatches.length})</h3>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                            Usable cuts produced by butchering — click <strong>Map to CK</strong> to transfer stock into Central Kitchen
                        </span>
                    </div>
                    {cutBatches.length > 0 && (
                        <div style={{ position: 'relative', width: 240 }}>
                            <MdSearch style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontSize: 16 }} />
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Search cut batches..."
                                value={cutSearchTerm}
                                onChange={(e) => setCutSearchTerm(e.target.value)}
                                style={{ paddingLeft: 32, height: 34, fontSize: 12 }}
                            />
                        </div>
                    )}
                </div>

                {loading ? (
                    <div className="butcher-loading">Loading cut meat inventory...</div>
                ) : cutBatches.length === 0 ? (
                    <div className="butcher-empty">
                        <p>No usable cut batches yet. Process raw meat in butchering to produce cuts.</p>
                        <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('uncut')}>
                            View Uncut Meat
                        </button>
                    </div>
                ) : filteredCutBatches.length === 0 ? (
                    <div className="butcher-empty"><p>No cut batches match your search.</p></div>
                ) : (
                    <div className="butcher-table-wrap">
                        <table className="butcher-table">
                            <thead>
                                <tr>
                                    <th>BATCH #</th>
                                    <th>CUT NAME</th>
                                    <th>PARENT BATCH</th>
                                    <th>AVAILABLE (kg)</th>
                                    <th>EXPIRY</th>
                                    <th style={{ width: 140, textAlign: 'center' }}>ACTION</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCutBatches.map(batch => {
                                    const available = safeNum(batch.remaining_qty ?? batch.remaining_weight_kg ?? batch.quantity);

                                    return (
                                        <tr key={batch.id}>
                                            <td>
                                                <span className="batch-code">{batch.batch_number || batch.id?.substring(0, 10)}</span>
                                            </td>
                                            <td style={{ fontWeight: 600 }}>{batch.cut_name || batch.item_name}</td>
                                            <td>
                                                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                                    {batch.parent_batch_no || '—'}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 700, color: 'var(--color-success)' }}>
                                                {available.toFixed(2)} kg
                                            </td>
                                            <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                {safeDate(batch.expiry_date)}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                                    onClick={() => setMappingCutBatch(batch)}
                                                    title="Map this cut meat to Central Kitchen (CK) inventory"
                                                >
                                                    <MdSyncAlt size={14} /> Map to CK
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            )}

            {/* Map to CK Modal */}
            <MapCutToCKModal
                cutBatch={mappingCutBatch}
                isOpen={Boolean(mappingCutBatch)}
                onClose={() => setMappingCutBatch(null)}
                onSuccess={() => load()}
            />
        </div>
    );
};

export default ButcherInventory;
