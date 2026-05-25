import React, { useState } from 'react';
import { MdClose, MdEdit, MdDelete, MdSave, MdCancel } from 'react-icons/md';
import { WASTE_CATEGORIES, getCategoryInfo, updateWasteEvent, deleteWasteEvent } from '../../services/wasteService';
import toast from 'react-hot-toast';

const formatDate = (d) => {
    if (!d) return '—';
    const date = d instanceof Date ? d : new Date(d);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatCurrency = (amt) => `£${(amt || 0).toFixed(2)}`;

/**
 * Waste Detail Modal — view, edit, delete with audit trail.
 */
const WasteDetailModal = ({ event, onClose, onUpdated, isAdmin, userProfile }) => {
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({
        quantity: event.quantity,
        category: event.category,
        notes: event.notes || '',
    });
    const [editReason, setEditReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteReason, setDeleteReason] = useState('');

    const catInfo = getCategoryInfo(event.category);

    const handleSave = async () => {
        if (!editReason.trim()) { toast.error('Please provide a reason for the edit'); return; }
        setSaving(true);
        try {
            await updateWasteEvent(event.id, {
                quantity: Number(editForm.quantity),
                category: editForm.category,
                notes: editForm.notes,
            }, editReason, userProfile);
            toast.success('Waste event updated');
            setEditing(false);
            if (onUpdated) onUpdated();
        } catch (err) {
            console.error('Update failed:', err);
            toast.error('Failed to update');
        } finally { setSaving(false); }
    };

    const handleDelete = async () => {
        if (!deleteReason.trim()) { toast.error('Please provide a reason for deletion'); return; }
        setSaving(true);
        try {
            await deleteWasteEvent(event.id, deleteReason, userProfile);
            toast.success('Waste event deleted');
            if (onUpdated) onUpdated();
            onClose();
        } catch (err) {
            console.error('Delete failed:', err);
            toast.error('Failed to delete');
        } finally { setSaving(false); }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, maxHeight: '90vh', overflow: 'auto', borderRadius: 16 }}>
                {/* Header */}
                <div className="modal-header" style={{ borderBottom: '1px solid var(--color-border)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                            {catInfo.icon} Waste Event Details
                            <span className={`waste-source-badge ${event.source === 'auto_expiry' ? 'auto' : 'manual'}`}>
                                {event.source === 'auto_expiry' ? '🤖 Auto' : '👤 Manual'}
                            </span>
                        </h2>
                    </div>
                    <button className="btn btn-icon" onClick={onClose}
                        style={{ background: 'var(--color-surface-hover)', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}>
                        <MdClose size={20} color="white" />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '24px' }}>
                    {/* Detail Grid */}
                    <div className="waste-detail-grid">
                        <div className="waste-detail-item">
                            <div className="detail-label">Item</div>
                            <div className="detail-value">{event.item_name}</div>
                        </div>
                        <div className="waste-detail-item">
                            <div className="detail-label">Item Type</div>
                            <div className="detail-value" style={{ textTransform: 'capitalize' }}>{(event.item_type || '').replace('_', ' ')}</div>
                        </div>
                        <div className="waste-detail-item">
                            <div className="detail-label">Quantity</div>
                            <div className="detail-value">
                                {editing ? (
                                    <input type="number" step="0.01" value={editForm.quantity}
                                        onChange={e => setEditForm(p => ({ ...p, quantity: e.target.value }))}
                                        style={{ width: 100, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)' }} />
                                ) : (
                                    <>{event.quantity} {event.item_unit}</>
                                )}
                            </div>
                        </div>
                        <div className="waste-detail-item">
                            <div className="detail-label">Estimated Value</div>
                            <div className="detail-value" style={{ color: '#ef4444', fontWeight: 700 }}>
                                {formatCurrency(editing ? (editForm.quantity * event.unit_cost) : event.total_value)}
                            </div>
                        </div>
                        <div className="waste-detail-item">
                            <div className="detail-label">Category</div>
                            <div className="detail-value">
                                {editing ? (
                                    <select value={editForm.category}
                                        onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                                        {WASTE_CATEGORIES.map(c => (
                                            <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className="waste-category-badge" style={{ background: `${catInfo.color}22`, color: catInfo.color }}>
                                        {catInfo.icon} {catInfo.label}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="waste-detail-item">
                            <div className="detail-label">Location</div>
                            <div className="detail-value">📍 {event.location_name}</div>
                        </div>
                        <div className="waste-detail-item">
                            <div className="detail-label">Date</div>
                            <div className="detail-value">{formatDate(event.created_at)}</div>
                        </div>
                        <div className="waste-detail-item">
                            <div className="detail-label">Submitted By</div>
                            <div className="detail-value">{event.submitted_by?.name || event.submitted_by?.email || '—'}</div>
                        </div>
                        {event.batch_number && (
                            <div className="waste-detail-item">
                                <div className="detail-label">Batch</div>
                                <div className="detail-value" style={{ fontFamily: 'monospace' }}>{event.batch_number}</div>
                            </div>
                        )}
                    </div>

                    {/* Notes */}
                    <div className="waste-detail-item" style={{ marginBottom: 16 }}>
                        <div className="detail-label">Notes</div>
                        {editing ? (
                            <textarea value={editForm.notes}
                                onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
                                style={{ width: '100%', minHeight: 60, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)', marginTop: 4, background: 'var(--color-surface)', color: 'var(--color-text)' }} />
                        ) : (
                            <div className="detail-value">{event.notes || '—'}</div>
                        )}
                    </div>

                    {/* Image Evidence */}
                    {event.image_data && !editing && (
                        <div className="waste-detail-item" style={{ marginBottom: 16 }}>
                            <div className="detail-label" style={{ marginBottom: 8 }}>Photo Evidence</div>
                            <img
                                src={event.image_data}
                                alt="Waste evidence"
                                style={{
                                    maxWidth: '100%',
                                    maxHeight: 250,
                                    borderRadius: 12,
                                    border: '1px solid var(--color-border)',
                                    display: 'block'
                                }}
                            />
                        </div>
                    )}

                    {/* Edit reason */}
                    {editing && (
                        <div className="waste-form-group" style={{ background: 'var(--color-surface-hover)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                            <label style={{ fontSize: 12 }}>Reason for Edit *</label>
                            <input type="text" placeholder="e.g. Quantity correction"
                                value={editReason} onChange={e => setEditReason(e.target.value)}
                                style={{ padding: '6px 10px' }} />
                        </div>
                    )}

                    {/* Delete confirmation */}
                    {showDeleteConfirm && (
                        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                            <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#ef4444', fontSize: 14 }}>⚠️ Are you sure you want to delete this waste event?</p>
                            <input type="text" placeholder="Reason for deletion *"
                                value={deleteReason} onChange={e => setDeleteReason(e.target.value)}
                                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ef4444', marginBottom: 10, background: 'var(--color-surface)', color: 'var(--color-text)' }} />
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-secondary btn-sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                                <button className="btn btn-sm" onClick={handleDelete} disabled={saving}
                                    style={{ background: '#ef4444', color: '#fff', border: 'none' }}>
                                    {saving ? 'Deleting...' : 'Confirm Delete'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Audit Trail */}
                    {event.audit_trail && event.audit_trail.length > 0 && (
                        <div className="audit-trail">
                            <h4>📋 Audit Trail</h4>
                            {event.audit_trail.map((entry, idx) => (
                                <div key={idx} className="audit-entry">
                                    <div className={`audit-icon ${entry.action}`}>
                                        {entry.action === 'created' ? '➕' : entry.action === 'edited' ? '✏️' : '🗑️'}
                                    </div>
                                    <div className="audit-content">
                                        <div>
                                            <strong style={{ textTransform: 'capitalize' }}>{entry.action}</strong> by {entry.by?.name || entry.by?.email || 'Unknown'}
                                        </div>
                                        {entry.reason && <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>Reason: {entry.reason}</div>}
                                        {entry.changes && Object.keys(entry.changes).length > 0 && (
                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                                {Object.entries(entry.changes).map(([field, val]) => (
                                                    <div key={field}>
                                                        {field}: <s>{String(val.from)}</s> → <strong>{String(val.to)}</strong>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="audit-meta">{formatDate(entry.at)}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    {isAdmin && !editing && !showDeleteConfirm && (
                        <>
                            <button className="btn btn-secondary btn-md" onClick={() => setShowDeleteConfirm(true)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444' }}>
                                <MdDelete /> Delete
                            </button>
                            <button className="btn btn-secondary btn-md" onClick={() => setEditing(true)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <MdEdit /> Edit
                            </button>
                        </>
                    )}
                    {editing && (
                        <>
                            <button className="btn btn-secondary btn-md" onClick={() => { setEditing(false); setEditReason(''); }}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <MdCancel /> Cancel
                            </button>
                            <button className="btn btn-primary btn-md" onClick={handleSave} disabled={saving}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <MdSave /> {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </>
                    )}
                    <button className="btn btn-secondary btn-md" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

export default WasteDetailModal;
