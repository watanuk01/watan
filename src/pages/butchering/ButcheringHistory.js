import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MdHistory,
    MdContentCut,
    MdSearch,
    MdQrCodeScanner,
    MdArrowBack,
    MdRefresh,
    MdFilterList,
} from 'react-icons/md';
import { getButcheringOrders } from '../../services/butcheringService';
import './ButcheringModule.css';

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
    for (const key of Object.keys(obj)) { result[key] = sanitize(obj[key]); }
    return result;
};

const safeNum = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };

const ButcheringHistory = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    const load = async () => {
        setLoading(true);
        try {
            const list = await getButcheringOrders();
            setOrders((list || []).map(sanitize));
        } catch (err) {
            console.error('History load error:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const filtered = orders.filter(o => {
        const q = search.toLowerCase();
        const matchSearch = !q ||
            (o.order_no || '').toLowerCase().includes(q) ||
            (o.source_batch_no || '').toLowerCase().includes(q) ||
            (o.source_product || '').toLowerCase().includes(q) ||
            (o.butcher_name || '').toLowerCase().includes(q);
        const matchStatus = statusFilter === 'all' || o.status === statusFilter;
        return matchSearch && matchStatus;
    });

    return (
        <div className="butcher-page">
            <div className="butcher-page-header">
                <div>
                    <button className="btn-back" onClick={() => navigate('/butchering/dashboard')}>
                        <MdArrowBack /> Back to Dashboard
                    </button>
                    <h1 className="butcher-page-title">
                        <MdHistory className="title-icon" /> Butchering History Log
                    </h1>
                    <p className="butcher-page-subtitle">
                        Full audit trail of every butchering order, yield &amp; waste record
                    </p>
                </div>
                <div className="butcher-header-actions">
                    <button className="btn btn-secondary btn-md" onClick={load}>
                        <MdRefresh /> Refresh
                    </button>
                    <button className="btn btn-primary btn-md" onClick={() => navigate('/butchering/new')}>
                        <MdContentCut /> New Order
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="butcher-panel" style={{ marginBottom: 20 }}>
                <div className="filter-row">
                    <div className="search-box-wrap">
                        <MdSearch className="search-icon-inner" size={18} />
                        <input
                            type="text"
                            placeholder="Search order no, batch, product or butcher..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <MdFilterList style={{ color: 'var(--color-text-muted)' }} />
                        <select
                            className="form-select"
                            style={{ width: 160 }}
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                        >
                            <option value="all">All Statuses</option>
                            <option value="completed">Completed</option>
                            <option value="in_progress">In Progress</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="butcher-panel">
                {loading ? (
                    <div className="butcher-loading">Loading butchering history...</div>
                ) : filtered.length === 0 ? (
                    <div className="butcher-empty">
                        <p>No orders match your search criteria.</p>
                    </div>
                ) : (
                    <div className="butcher-table-wrap">
                        <table className="butcher-table">
                            <thead>
                                <tr>
                                    <th>Order No</th>
                                    <th>Source Batch</th>
                                    <th>Input Weight</th>
                                    <th>Output Weight</th>
                                    <th>Waste</th>
                                    <th>Yield %</th>
                                    <th>Butcher</th>
                                    <th>Date</th>
                                    <th>Status</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(o => (
                                    <tr key={o.id}>
                                        <td><span className="batch-code">{o.order_no}</span></td>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{o.source_batch_no}</div>
                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{o.source_product}</div>
                                        </td>
                                        <td>{safeNum(o.input_weight_kg)} kg</td>
                                        <td>{safeNum(o.output_weight_kg)} kg</td>
                                        <td><span style={{ color: 'var(--color-danger)' }}>{safeNum(o.waste_weight_kg)} kg</span></td>
                                        <td>
                                            <span className={`yield-badge ${safeNum(o.yield_pct) >= 90 ? 'high' : 'medium'}`}>
                                                {safeNum(o.yield_pct)}%
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--color-text-secondary)' }}>{o.butcher_name || '—'}</td>
                                        <td style={{ color: 'var(--color-text-muted)' }}>{o.date || '—'}</td>
                                        <td>
                                            <span className={`chip-${o.status === 'completed' ? 'green' : o.status === 'in_progress' ? 'amber' : 'red'}`}>
                                                {o.status || 'completed'}
                                            </span>
                                        </td>
                                        <td>
                                            <button
                                                className="btn-link-sm"
                                                onClick={() => navigate(`/traceability?batch=${o.source_batch_no}`)}
                                            >
                                                <MdQrCodeScanner /> Trace
                                            </button>
                                        </td>
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

export default ButcheringHistory;
