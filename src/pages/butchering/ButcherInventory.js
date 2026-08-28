import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MdInventory2,
    MdArrowBack,
    MdRefresh,
    MdContentCut,
} from 'react-icons/md';
import { getButcherInventory } from '../../services/butcheringService';
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

    const load = async () => {
        setLoading(true);
        try {
            const list = await getButcherInventory();
            setBatches(list || []);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load butcher inventory');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const totalWeight = batches.reduce((s, b) => s + safeNum(b.quantity || b.remaining_weight_kg || b.initial_quantity), 0);
    const pendingBatches = batches.filter(b => b.butchered_status !== 'completed');

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
                        Received uncut meat available for butchering — select to start a butchering order
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
                    { label: 'Total Batches', value: batches.length, color: 'var(--color-primary)' },
                    { label: 'Pending Butchering', value: pendingBatches.length, color: '#f59e0b' },
                    { label: 'Total Weight', value: `${totalWeight.toFixed(1)} kg`, color: '#22c55e' },
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

            {/* Inventory Table */}
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
                                    const qty = safeNum(batch.quantity || batch.remaining_weight_kg || batch.initial_quantity);
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
        </div>
    );
};

export default ButcherInventory;
