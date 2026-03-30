import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
    getProductions,
    completeProduction,
    cancelProduction,
    getStatusInfo,
} from '../../services/productionService';
import {
    MdOutlineKitchen,
    MdAdd,
    MdRefresh,
    MdCheckCircle,
    MdClose,
    MdPlayArrow,
    MdCancel,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Production.css';

const InProgress = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [productions, setProductions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [completeModal, setCompleteModal] = useState(null);
    const [actualOutput, setActualOutput] = useState('');
    const [completing, setCompleting] = useState(false);
    const [cancelConfirm, setCancelConfirm] = useState(null);

    const fetchProductions = useCallback(async () => {
        setLoading(true);
        try {
            const inProgress = await getProductions({ status: 'in_progress' });
            setProductions(inProgress);
        } catch (err) {
            toast.error('Failed to load productions');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchProductions(); }, [fetchProductions]);

    const formatDateTime = (date) => {
        if (!date) return '—';
        return new Date(date).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const handleComplete = async () => {
        if (!completeModal) return;
        setCompleting(true);
        try {
            const result = await completeProduction(completeModal.id, {
                actual_output: actualOutput ? Number(actualOutput) : null,
                completed_by: user?.name || user?.email || '',
            });

            toast.success(
                `✅ ${result.actual_output}${completeModal.item_unit || 'kg'} ${completeModal.item_name} produced!\nBatch: ${result.batch_number}\nInvoice: ${result.invoice_number}`,
                { duration: 5000 }
            );
            setCompleteModal(null);
            setActualOutput('');
            fetchProductions();
        } catch (err) {
            toast.error(err.message || 'Failed to complete production');
        } finally {
            setCompleting(false);
        }
    };

    const handleCancel = async (prodId) => {
        try {
            await cancelProduction(prodId, 'Cancelled by user');
            toast.success('Production cancelled');
            setCancelConfirm(null);
            fetchProductions();
        } catch (err) {
            toast.error('Failed to cancel production');
        }
    };

    const openCompleteModal = (prod) => {
        setCompleteModal(prod);
        setActualOutput(String(prod.production_quantity));
    };

    const getTypeIcon = (type) => type === 'raw_meat' ? '🥩' : '🛒';

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdPlayArrow style={{ marginRight: 'var(--space-2)' }} />
                        In Progress
                    </h1>
                    <p className="page-subtitle">{productions.length} active production{productions.length !== 1 ? 's' : ''}</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn-refresh" onClick={fetchProductions}><MdRefresh /></button>
                    <button className="btn btn-primary btn-md" onClick={() => navigate('/production/start')}>
                        <MdAdd /> New Production
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="prod-cards-grid">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="prod-card">
                            <div className="prod-card-header">
                                <div className="skeleton skeleton-text" style={{ width: '60%' }} />
                            </div>
                            <div className="prod-card-body">
                                <div className="skeleton skeleton-text" style={{ width: '80%', marginBottom: 8 }} />
                                <div className="skeleton skeleton-text" style={{ width: '50%' }} />
                            </div>
                        </div>
                    ))}
                </div>
            ) : productions.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                    <MdOutlineKitchen style={{ fontSize: 48, color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }} />
                    <h3 style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                        No Active Productions
                    </h3>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
                        Start a new production to begin cooking.
                    </p>
                    <button className="btn btn-primary btn-md" onClick={() => navigate('/production/start')}>
                        <MdAdd /> Start New Production
                    </button>
                </div>
            ) : (
                <div className="prod-cards-grid">
                    {productions.map(prod => (
                        <div key={prod.id} className="prod-card">
                            <div className="prod-card-header">
                                <h4>🍛 {prod.item_name}</h4>
                                <span className="prod-status-badge in_progress">🔥 In Progress</span>
                            </div>
                            <div className="prod-card-body">
                                <div className="prod-card-meta">
                                    <div>
                                        <div className="meta-label">Production #</div>
                                        <div className="meta-value" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-xs)' }}>
                                            {prod.production_number}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="meta-label">Quantity</div>
                                        <div className="meta-value" style={{ color: 'var(--color-primary)' }}>
                                            {prod.production_quantity} {prod.item_unit || 'kg'}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="meta-label">Chef</div>
                                        <div className="meta-value">{prod.chef_name || '—'}</div>
                                    </div>
                                    <div>
                                        <div className="meta-label">Started</div>
                                        <div className="meta-value">{formatDateTime(prod.started_at)}</div>
                                    </div>
                                </div>

                                {/* Ingredients summary */}
                                <div style={{
                                    fontSize: 'var(--text-xs)',
                                    color: 'var(--color-text-muted)',
                                    marginTop: 'var(--space-2)',
                                }}>
                                    <strong>Ingredients ({prod.ingredients?.length || 0}):</strong>{' '}
                                    {(prod.ingredients || []).map(i => i.item_name).join(', ')}
                                </div>

                                {prod.notes && (
                                    <div style={{
                                        marginTop: 'var(--space-2)',
                                        fontSize: 'var(--text-xs)',
                                        color: 'var(--color-text-muted)',
                                        fontStyle: 'italic',
                                    }}>
                                        Note: {prod.notes}
                                    </div>
                                )}
                            </div>
                            <div className="prod-card-footer">
                                <button
                                    className="btn btn-primary btn-sm"
                                    style={{ flex: 1 }}
                                    onClick={() => openCompleteModal(prod)}
                                >
                                    <MdCheckCircle /> Cooking Completed
                                </button>
                                <button
                                    className="btn btn-ghost btn-sm"
                                    style={{ color: 'var(--color-danger)' }}
                                    onClick={() => setCancelConfirm(prod.id)}
                                    title="Cancel Production"
                                >
                                    <MdCancel />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ═══ Complete Production Modal ═══ */}
            {completeModal && (
                <div className="modal-overlay" onClick={() => { setCompleteModal(null); setActualOutput(''); }}>
                    <div className="modal modal-md" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>✅ Complete Production</h2>
                            <button className="modal-close" onClick={() => { setCompleteModal(null); setActualOutput(''); }}>
                                <MdClose />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="complete-prod-modal-body">
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: 'var(--space-3)',
                                    marginBottom: 'var(--space-3)',
                                }}>
                                    <div>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Item</div>
                                        <div style={{ fontWeight: 700 }}>🍛 {completeModal.item_name}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Planned Output</div>
                                        <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                                            {completeModal.production_quantity} {completeModal.item_unit || 'kg'}
                                        </div>
                                    </div>
                                </div>

                                <div className="output-adjustment">
                                    <label>Actual Output Quantity ({completeModal.item_unit || 'kg'})</label>
                                    <input
                                        type="number"
                                        className="form-input"
                                        value={actualOutput}
                                        onChange={e => setActualOutput(e.target.value)}
                                        min="0.1"
                                        step="0.1"
                                        placeholder={String(completeModal.production_quantity)}
                                    />
                                    <span className="form-hint" style={{ marginTop: 'var(--space-1)', display: 'block' }}>
                                        Adjust if actual output differs due to yield loss. Leave as-is if output matches planned quantity.
                                    </span>
                                </div>

                                {/* Ingredients already deducted */}
                                <div>
                                    <h4 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                                        Ingredients (already deducted at start):
                                    </h4>
                                    {(completeModal.ingredients || []).map((ing, i) => (
                                        <div key={i} style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            padding: 'var(--space-1) 0',
                                            fontSize: 'var(--text-sm)',
                                            borderBottom: '1px solid var(--color-divider)',
                                        }}>
                                            <span>{getTypeIcon(ing.item_type)} {ing.item_name}</span>
                                            <span style={{ fontWeight: 600, textAlign: 'right' }}>
                                                {ing.required_sub_quantity || ing.required_quantity} {ing.unit}
                                                {ing.unit !== ing.master_unit && ing.master_unit && (
                                                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: 'var(--space-2)' }}>
                                                        (= {ing.required_quantity} {ing.master_unit})
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <div style={{
                                    padding: 'var(--space-3)',
                                    background: 'rgba(34, 197, 94, 0.06)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid rgba(34, 197, 94, 0.15)',
                                    fontSize: 'var(--text-sm)',
                                    color: 'var(--color-text-secondary)',
                                }}>
                                    ✅ Upon confirmation, the system will:<br />
                                    • Create a new cooked meat batch ({actualOutput || completeModal.production_quantity} {completeModal.item_unit || 'kg'})<br />
                                    • Generate a production invoice<br />
                                    <em>Note: Ingredients were already deducted when production started.</em>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary btn-md" onClick={() => { setCompleteModal(null); setActualOutput(''); }} disabled={completing}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary btn-md"
                                onClick={handleComplete}
                                disabled={completing || !actualOutput || Number(actualOutput) <= 0}
                            >
                                {completing ? 'Processing...' : (
                                    <>
                                        <MdCheckCircle /> Confirm Completed
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ Cancel Confirmation ═══ */}
            {cancelConfirm && (
                <div className="modal-overlay" onClick={() => setCancelConfirm(null)}>
                    <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Cancel Production?</h2>
                            <button className="modal-close" onClick={() => setCancelConfirm(null)}>
                                <MdClose />
                            </button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--color-text-secondary)' }}>
                                Are you sure you want to cancel this production? <strong>All deducted ingredients will be restored</strong> back to inventory.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary btn-md" onClick={() => setCancelConfirm(null)}>
                                Keep
                            </button>
                            <button className="btn btn-danger btn-md" onClick={() => handleCancel(cancelConfirm)}>
                                Cancel Production
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InProgress;
