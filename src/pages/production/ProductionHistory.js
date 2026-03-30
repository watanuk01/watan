import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getProductions,
    getStatusInfo,
    PROD_STATUSES,
    getCookedMeatItems,
} from '../../services/productionService';
import {
    MdHistory,
    MdRefresh,
    MdFileDownload,
    MdClose,
    MdVisibility,
    MdAdd,
    MdOutlineKitchen,
} from 'react-icons/md';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import './Production.css';

const ProductionHistory = () => {
    const navigate = useNavigate();
    const [productions, setProductions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [cookedItems, setCookedItems] = useState([]);
    const [filters, setFilters] = useState({
        status: '',
        item_id: '',
        dateFrom: '',
        dateTo: '',
        search: '',
    });
    const [detailModal, setDetailModal] = useState(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [prods, items] = await Promise.all([
                getProductions({
                    ...(filters.status && { status: filters.status }),
                    ...(filters.item_id && { item_id: filters.item_id }),
                    ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
                    ...(filters.dateTo && { dateTo: filters.dateTo }),
                }),
                getCookedMeatItems(),
            ]);
            setProductions(prods);
            setCookedItems(items);
        } catch (err) {
            toast.error('Failed to load production history');
        } finally {
            setLoading(false);
        }
    }, [filters.status, filters.item_id, filters.dateFrom, filters.dateTo]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const filteredProductions = productions.filter(p => {
        if (!filters.search) return true;
        const q = filters.search.toLowerCase();
        return (
            p.production_number?.toLowerCase().includes(q) ||
            p.item_name?.toLowerCase().includes(q) ||
            p.chef_name?.toLowerCase().includes(q)
        );
    });

    const formatDate = (date) => {
        if (!date) return '—';
        return new Date(date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    };
    const formatDateTime = (date) => {
        if (!date) return '—';
        return new Date(date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const getTypeIcon = (type) => type === 'raw_meat' ? '🥩' : '🛒';

    // Export to Excel
    const handleExport = () => {
        if (filteredProductions.length === 0) {
            toast.error('No data to export');
            return;
        }

        const summaryData = filteredProductions.map(p => ({
            'Production #': p.production_number,
            'Status': getStatusInfo(p.status).label,
            'Item': p.item_name,
            'Planned Qty': p.production_quantity,
            'Actual Output': p.actual_output || '—',
            'Unit': p.item_unit || 'kg',
            'Chef': p.chef_name || '',
            'Started': formatDateTime(p.started_at),
            'Completed': formatDateTime(p.completed_at),
            'Total Cost (£)': p.total_ingredient_cost?.toFixed(2) || '—',
            'Cost/Unit (£)': p.cost_per_unit?.toFixed(2) || '—',
            'Output Batch': p.output_batch_number || '—',
            'Invoice #': p.invoice_number || '—',
        }));
        const ws = XLSX.utils.json_to_sheet(summaryData);

        // Ingredients sheet
        const ingredientRows = [];
        filteredProductions.forEach(p => {
            (p.ingredients || []).forEach(ing => {
                ingredientRows.push({
                    'Production #': p.production_number,
                    'Item': p.item_name,
                    'Ingredient': ing.item_name,
                    'Type': ing.item_type,
                    'Required': `${ing.required_sub_quantity || ing.required_quantity} ${ing.unit}`,
                    'Consumed': `${ing.consumed_quantity || 0} ${ing.master_unit || ing.unit}`,
                    'Unit': ing.unit,
                    'Cost (£)': ing.cost?.toFixed(2) || '—',
                    'Source Batches': (ing.consumed_batches || []).map(b => b.batch_number).join(', '),
                });
            });
        });
        const wsIngredients = XLSX.utils.json_to_sheet(ingredientRows);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Production History');
        XLSX.utils.book_append_sheet(wb, wsIngredients, 'Ingredients');
        XLSX.writeFile(wb, `Watan_Production_History_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success('Exported to Excel');
    };

    // Stats
    const completed = productions.filter(p => p.status === 'completed');
    const totalProduced = completed.reduce((s, p) => s + (p.actual_output || p.production_quantity || 0), 0);
    const totalCost = completed.reduce((s, p) => s + (p.total_ingredient_cost || 0), 0);

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdHistory style={{ marginRight: 'var(--space-2)' }} />
                        Production History
                    </h1>
                    <p className="page-subtitle">{filteredProductions.length} records found</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={filteredProductions.length === 0}>
                        <MdFileDownload /> Export Excel
                    </button>
                    <button className="btn btn-primary btn-md" onClick={() => navigate('/production/start')}>
                        <MdAdd /> New Production
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 'var(--space-4)',
                marginBottom: 'var(--space-6)',
            }}>
                {[
                    { label: 'Total Productions', value: productions.length, color: 'var(--color-text-primary)' },
                    { label: 'Completed', value: completed.length, color: '#22c55e' },
                    { label: 'Total Produced', value: `${totalProduced.toFixed(2)} kg`, color: 'var(--color-primary)' },
                    { label: 'Total Cost', value: `£${totalCost.toFixed(2)}`, color: 'var(--color-primary)' },
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
                <input
                    type="text"
                    className="form-input"
                    placeholder="Search production #, item, or chef..."
                    value={filters.search}
                    onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                    style={{ minWidth: 250 }}
                />
                <select
                    className="form-input"
                    value={filters.status}
                    onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                    style={{ maxWidth: 180 }}
                >
                    <option value="">All Statuses</option>
                    {PROD_STATUSES.map(s => (
                        <option key={s.value} value={s.value}>{s.icon} {s.label}</option>
                    ))}
                </select>
                <select
                    className="form-input"
                    value={filters.item_id}
                    onChange={e => setFilters(f => ({ ...f, item_id: e.target.value }))}
                    style={{ maxWidth: 200 }}
                >
                    <option value="">All Items</option>
                    {cookedItems.map(item => (
                        <option key={item.id} value={item.id}>🍛 {item.name}</option>
                    ))}
                </select>
                <input
                    type="date"
                    className="form-input"
                    value={filters.dateFrom}
                    onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                    style={{ maxWidth: 155 }}
                    title="From date"
                />
                <input
                    type="date"
                    className="form-input"
                    value={filters.dateTo}
                    onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                    style={{ maxWidth: 155 }}
                    title="To date"
                />
                <button className="btn-refresh" onClick={fetchData}><MdRefresh /></button>
            </div>

            {/* Table */}
            <div className="card">
                <div className="data-table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Production #</th>
                                <th>Item</th>
                                <th>Qty</th>
                                <th>Output</th>
                                <th>Status</th>
                                <th>Chef</th>
                                <th>Started</th>
                                <th>Cost</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i}>{Array.from({ length: 9 }).map((_, j) => (
                                        <td key={j}><div className="skeleton skeleton-text" /></td>
                                    ))}</tr>
                                ))
                            ) : filteredProductions.length === 0 ? (
                                <tr>
                                    <td colSpan="9" style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
                                        <MdOutlineKitchen style={{ fontSize: 32, display: 'block', margin: '0 auto var(--space-2)' }} />
                                        No production records found
                                    </td>
                                </tr>
                            ) : (
                                filteredProductions.map(prod => {
                                    const status = getStatusInfo(prod.status);
                                    return (
                                        <tr key={prod.id} style={{ cursor: 'pointer' }} onClick={() => setDetailModal(prod)}>
                                            <td>
                                                <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--color-primary)', fontSize: 'var(--text-xs)' }}>
                                                    {prod.production_number}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 600 }}>🍛 {prod.item_name}</td>
                                            <td>{prod.production_quantity} {prod.item_unit || 'kg'}</td>
                                            <td style={{ fontWeight: 600, color: prod.actual_output ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                                                {prod.actual_output ? `${prod.actual_output} ${prod.item_unit || 'kg'}` : '—'}
                                            </td>
                                            <td>
                                                <span className={`prod-status-badge ${prod.status}`}>
                                                    {status.icon} {status.label}
                                                </span>
                                            </td>
                                            <td>{prod.chef_name || '—'}</td>
                                            <td>{formatDate(prod.started_at)}</td>
                                            <td style={{ fontWeight: 600 }}>
                                                {prod.total_ingredient_cost != null ? `£${prod.total_ingredient_cost.toFixed(2)}` : '—'}
                                            </td>
                                            <td>
                                                <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setDetailModal(prod); }}>
                                                    <MdVisibility />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ═══ Detail Modal ═══ */}
            {detailModal && (
                <div className="modal-overlay" onClick={() => setDetailModal(null)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Production — {detailModal.production_number}</h2>
                            <button className="modal-close" onClick={() => setDetailModal(null)}>
                                <MdClose />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                                <span className={`prod-status-badge ${detailModal.status}`} style={{ fontSize: 'var(--text-md)', padding: '6px 16px' }}>
                                    {getStatusInfo(detailModal.status).icon} {getStatusInfo(detailModal.status).label}
                                </span>
                            </div>

                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr 1fr',
                                gap: 'var(--space-4)',
                                marginBottom: 'var(--space-5)',
                            }}>
                                {[
                                    { label: 'Item', value: `🍛 ${detailModal.item_name}` },
                                    { label: 'Planned Qty', value: `${detailModal.production_quantity} ${detailModal.item_unit || 'kg'}` },
                                    { label: 'Actual Output', value: detailModal.actual_output ? `${detailModal.actual_output} ${detailModal.item_unit || 'kg'}` : '—' },
                                    { label: 'Scale Factor', value: `${detailModal.scale_factor?.toFixed(2) || '—'}×` },
                                    { label: 'Chef', value: detailModal.chef_name || '—' },
                                    { label: 'Started', value: formatDateTime(detailModal.started_at) },
                                    { label: 'Completed', value: formatDateTime(detailModal.completed_at) },
                                    { label: 'Output Batch', value: detailModal.output_batch_number || '—' },
                                    { label: 'Invoice', value: detailModal.invoice_number || '—' },
                                ].map((info, i) => (
                                    <div key={i}>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                            {info.label}
                                        </div>
                                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)' }}>
                                            {info.value}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Ingredients */}
                            <div className="data-table-wrapper" style={{ maxHeight: 350, overflow: 'auto' }}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Ingredient</th>
                                            <th>Type</th>
                                            <th>Required</th>
                                            <th>Consumed</th>
                                            <th>Cost (£)</th>
                                            <th>Source Batches</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(detailModal.ingredients || []).map((ing, i) => (
                                            <tr key={i}>
                                                <td style={{ fontWeight: 600 }}>{getTypeIcon(ing.item_type)} {ing.item_name}</td>
                                                <td><span className="badge badge-info" style={{ fontSize: 'var(--text-xs)' }}>{ing.item_type}</span></td>
                                                <td>
                                                    {ing.required_sub_quantity || ing.required_quantity} {ing.unit}
                                                    {ing.unit !== ing.master_unit && ing.master_unit && (
                                                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', display: 'block' }}>
                                                            (= {ing.required_quantity} {ing.master_unit})
                                                        </span>
                                                    )}
                                                </td>
                                                <td style={{ fontWeight: 600, color: ing.consumed_quantity >= ing.required_quantity ? '#22c55e' : '#f59e0b' }}>
                                                    {ing.consumed_quantity || 0} {ing.master_unit || ing.unit}
                                                </td>
                                                <td style={{ fontWeight: 600 }}>
                                                    {ing.cost != null ? `£${ing.cost.toFixed(2)}` : '—'}
                                                </td>
                                                <td style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono, monospace)' }}>
                                                    {(ing.consumed_batches || []).map(b => b.batch_number).join(', ') || '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Cost Summary */}
                            {detailModal.total_ingredient_cost != null && (
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
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Total Cost</div>
                                        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>£{detailModal.total_ingredient_cost.toFixed(2)}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Cost/Unit</div>
                                        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-primary)' }}>
                                            £{detailModal.cost_per_unit?.toFixed(2) || '—'}/{detailModal.item_unit || 'kg'}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary btn-md" onClick={() => setDetailModal(null)}>Close</button>
                            {detailModal.invoice_number && (
                                <button className="btn btn-primary btn-md" onClick={() => { setDetailModal(null); navigate('/production/invoices'); }}>
                                    View Invoice
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductionHistory;
