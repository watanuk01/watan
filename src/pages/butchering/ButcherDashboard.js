import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MdContentCut,
    MdAddCircle,
    MdQrCodeScanner,
    MdShoppingCart,
    MdSettings,
    MdTrendingUp,
    MdWarning,
    MdTimer,
    MdRefresh,
    MdArrowForward,
    MdInventory2,
    MdBarChart,
} from 'react-icons/md';
import {
    getButcheringOrders,
    getButcherInventory,
} from '../../services/butcheringService';
import './ButcheringModule.css';

/** Recursively sanitize all fields in a Firestore document object, converting any Timestamps to strings */
const sanitize = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitize);
    if (obj.seconds !== undefined) {
        return new Date(obj.seconds * 1000).toLocaleDateString('en-GB');
    }
    if (obj._methodName || (obj.constructor && obj.constructor.name === 'FieldValue')) {
        return new Date().toLocaleDateString('en-GB');
    }
    if (obj instanceof Date) {
        return obj.toLocaleDateString('en-GB');
    }
    const result = {};
    for (const key of Object.keys(obj)) {
        result[key] = sanitize(obj[key]);
    }
    return result;
};

const safeNum = (val) => {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
};

const safeDate = (val) => {
    if (!val) return '—';
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return new Date(val).toLocaleDateString('en-GB');
    if (val instanceof Date) return val.toLocaleDateString('en-GB');
    if (typeof val === 'object') {
        if (val.seconds !== undefined && typeof val.seconds === 'number') {
            return new Date(val.seconds * 1000).toLocaleDateString('en-GB');
        }
        if (typeof val.toDate === 'function') {
            return val.toDate().toLocaleDateString('en-GB');
        }
        return '—';
    }
    return String(val);
};

const ButcherDashboard = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState([]);
    const [pendingBatches, setPendingBatches] = useState([]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [orderList, unbutchered] = await Promise.all([
                getButcheringOrders(),
                getButcherInventory(),
            ]);
            setOrders((orderList || []).map(sanitize));
            setPendingBatches((unbutchered || []).map(sanitize));
        } catch (err) {
            console.error('Butcher dashboard load error:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    const todayStr = new Date().toISOString().substring(0, 10);
    const todaysOrders = orders.filter(o => o.date === todayStr);
    const activeOrders = orders.filter(o => o.status === 'in_progress');

    const completedOrders = orders.filter(o => safeNum(o.yield_pct) > 0);
    const avgYield = completedOrders.length > 0
        ? Math.round(completedOrders.reduce((s, o) => s + safeNum(o.yield_pct), 0) / completedOrders.length * 10) / 10
        : 0;

    const twoDays = Date.now() + 48 * 3600 * 1000;
    const expiringCount = pendingBatches.filter(b => {
        if (!b.expiry_date || typeof b.expiry_date !== 'string') return false;
        return new Date(b.expiry_date).getTime() <= twoDays;
    }).length;

    return (
        <div className="butcher-page">
            {/* Header */}
            <div className="butcher-page-header">
                <div>
                    <h1 className="butcher-page-title">
                        <MdContentCut className="title-icon" />
                        Butchering Operations
                    </h1>
                    <p className="butcher-page-subtitle">
                        Manage whole meat processing, yield tracking, batch creation &amp; QR code traceability
                    </p>
                </div>
                <div className="butcher-header-actions">
                    <button className="btn btn-secondary btn-md" onClick={loadData}>
                        <MdRefresh /> Refresh
                    </button>
                    <button className="btn btn-primary btn-md" onClick={() => navigate('/butchering/new')}>
                        <MdAddCircle /> New Butchering Order
                    </button>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="butcher-actions-row">
                <button className="butcher-action-card" onClick={() => navigate('/butchering/new')}>
                    <div className="action-card-icon" style={{ background: 'rgba(52,211,153,0.12)', color: 'var(--color-success)' }}>
                        <MdContentCut />
                    </div>
                    <div>
                        <div className="action-card-label">Start Butchering Order</div>
                        <div className="action-card-desc">Process parent meat batch into cut items</div>
                    </div>
                </button>

                <button className="butcher-action-card" onClick={() => navigate('/traceability')}>
                    <div className="action-card-icon" style={{ background: 'var(--color-primary-muted)', color: 'var(--color-primary)' }}>
                        <MdQrCodeScanner />
                    </div>
                    <div>
                        <div className="action-card-label">Batch Traceability &amp; QR</div>
                        <div className="action-card-desc">Scan or search full batch genealogy tree</div>
                    </div>
                </button>

                <button className="butcher-action-card" onClick={() => navigate('/butchering/purchase-order')}>
                    <div className="action-card-icon" style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
                        <MdShoppingCart />
                    </div>
                    <div>
                        <div className="action-card-label">Meat Purchase Order</div>
                        <div className="action-card-desc">Order whole animals &amp; raw meat from suppliers</div>
                    </div>
                </button>

                <button className="butcher-action-card" onClick={() => navigate('/reports?tab=butcher')}>
                    <div className="action-card-icon" style={{ background: 'rgba(201,169,110,0.15)', color: 'var(--color-primary)' }}>
                        <MdBarChart />
                    </div>
                    <div>
                        <div className="action-card-label">Reports &amp; Yield Analytics</div>
                        <div className="action-card-desc">View yield breakdown, species analytics &amp; reports</div>
                    </div>
                </button>

                <button className="butcher-action-card" onClick={() => navigate('/butchering/cut-types')}>
                    <div className="action-card-icon" style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}>
                        <MdSettings />
                    </div>
                    <div>
                        <div className="action-card-label">Cut Types Admin</div>
                        <div className="action-card-desc">Define standard weights, shelf life &amp; waste</div>
                    </div>
                </button>
            </div>

            {/* Metrics */}
            <div className="butcher-metrics-row">
                <div className="butcher-metric-card">
                    <div className="metric-top">
                        <span className="metric-name">Today's Tasks</span>
                        <span className="chip-blue"><MdTimer style={{ fontSize: 11 }} /> Scheduled</span>
                    </div>
                    <div className="metric-number">{todaysOrders.length || pendingBatches.length}</div>
                    <div className="metric-caption">Parent batches queued for processing</div>
                </div>

                <div className="butcher-metric-card">
                    <div className="metric-top">
                        <span className="metric-name">Active Orders</span>
                        <span className="chip-amber">In Progress</span>
                    </div>
                    <div className="metric-number">{activeOrders.length || orders.length}</div>
                    <div className="metric-caption">Butchering operations logged</div>
                </div>

                <div className="butcher-metric-card">
                    <div className="metric-top">
                        <span className="metric-name">Average Yield</span>
                        <span className="chip-green"><MdTrendingUp style={{ fontSize: 11 }} /> Target &gt;90%</span>
                    </div>
                    <div className="metric-number" style={{ color: avgYield >= 90 ? 'var(--color-success)' : avgYield > 0 ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
                        {avgYield > 0 ? `${avgYield}%` : '—'}
                    </div>
                    <div className="metric-caption">Usable output vs raw input weight</div>
                </div>

                <div className="butcher-metric-card">
                    <div className="metric-top">
                        <span className="metric-name">Pending Batches</span>
                        <span className="chip-gold"><MdInventory2 style={{ fontSize: 11 }} /> Raw Meat</span>
                    </div>
                    <div className="metric-number">{pendingBatches.length}</div>
                    <div className="metric-caption">Whole animals waiting to be cut</div>
                </div>

                <div className="butcher-metric-card">
                    <div className="metric-top">
                        <span className="metric-name">Expiring (&lt;48h)</span>
                        <span className="chip-red"><MdWarning style={{ fontSize: 11 }} /> Urgent</span>
                    </div>
                    <div className="metric-number" style={{ color: expiringCount > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                        {expiringCount}
                    </div>
                    <div className="metric-caption">Batches requiring immediate processing</div>
                </div>
            </div>

            {/* Two-column: Recent Orders + Pending Batches */}
            <div className="butcher-col-2">
                {/* Recent Orders */}
                <div className="butcher-panel">
                    <div className="butcher-panel-header">
                        <h3 className="butcher-panel-title"><MdContentCut /> Recent Activity</h3>
                        <button className="btn-text-link" onClick={() => navigate('/butchering/history')}>
                            View All <MdArrowForward />
                        </button>
                    </div>

                    {loading ? (
                        <div className="butcher-loading">Loading butchering orders...</div>
                    ) : orders.length === 0 ? (
                        <div className="butcher-empty">
                            <p>No butchering orders created yet.</p>
                            <button className="btn btn-primary btn-sm" onClick={() => navigate('/butchering/new')}>
                                Create First Order
                            </button>
                        </div>
                    ) : (
                        <div className="butcher-table-wrap">
                            <table className="butcher-table">
                                <thead>
                                    <tr>
                                        <th>Order No</th>
                                        <th>Source Batch</th>
                                        <th>Input</th>
                                        <th>Output</th>
                                        <th>Yield</th>
                                        <th>Date</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {orders.map(o => (
                                        <tr key={o.id}>
                                            <td><span className="batch-code">{o.order_no}</span></td>
                                            <td style={{ color: 'var(--color-text-secondary)' }}>{o.source_batch_no || 'Whole Meat'}</td>
                                            <td>{safeNum(o.input_weight_kg)} kg</td>
                                            <td>{safeNum(o.output_weight_kg)} kg</td>
                                            <td>
                                                <span className={`yield-badge ${safeNum(o.yield_pct) >= 90 ? 'high' : 'medium'}`}>
                                                    {safeNum(o.yield_pct)}%
                                                </span>
                                            </td>
                                            <td style={{ color: 'var(--color-text-muted)' }}>{o.date || '—'}</td>
                                            <td>
                                                <button
                                                    className="btn-link-sm"
                                                    onClick={() => navigate(`/traceability?batch=${o.source_batch_no}`)}
                                                >
                                                    Trace
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Pending Parent Batches */}
                <div className="butcher-panel">
                    <div className="butcher-panel-header">
                        <h3 className="butcher-panel-title"><MdInventory2 /> Whole Meat Awaiting Processing</h3>
                        <button className="btn-text-link" onClick={() => navigate('/inventory/batches')}>
                            All Inventory <MdArrowForward />
                        </button>
                    </div>

                    {loading ? (
                        <div className="butcher-loading">Loading parent batches...</div>
                    ) : pendingBatches.length === 0 ? (
                        <div className="butcher-empty">
                            <p>All whole meat batches have been processed!</p>
                        </div>
                    ) : (
                        <div className="pending-batch-list">
                            {pendingBatches.map(b => (
                                <div key={b.id} className="pending-batch-row">
                                    <div>
                                        <div className="pb-batch-no">{b.batch_number || b.id}</div>
                                        <div className="pb-product">{b.item_name || 'Whole Meat'}</div>
                                        <div className="pb-meta">
                                            {b.vendor_name || b.supplier || 'Meat Supplier'} &nbsp;•&nbsp; Expiry: {safeDate(b.expiry_date)}
                                        </div>
                                    </div>
                                    <div className="pb-right">
                                        <span className="pb-weight">
                                            {safeNum(b.weight_kg || b.quantity || b.initial_quantity || 10)} kg
                                        </span>
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={() => navigate(`/butchering/new?source=${b.id}`)}
                                        >
                                            <MdContentCut /> Cut Now
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ButcherDashboard;
