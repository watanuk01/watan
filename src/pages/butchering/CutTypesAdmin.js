import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MdSettings,
    MdAdd,
    MdDelete,
    MdEdit,
    MdSave,
    MdClose,
    MdArrowBack,
    MdContentCut,
    MdRefresh,
} from 'react-icons/md';
import {
    getCutTypes,
    createCutType,
    updateCutType,
    deleteCutType,
} from '../../services/butcheringService';
import toast from 'react-hot-toast';
import './ButcheringModule.css';

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


const BLANK_FORM = { name: '', animal_type: 'Lamb', std_weight_kg: '', shelf_life_days: 5, is_waste: false, notes: '' };

const ANIMALS = ['Lamb', 'Mutton', 'Goat', 'Chicken', 'Beef', 'Seafood', 'Pork', 'Turkey', 'Duck', 'Other'];

const CutTypesAdmin = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [cuts, setCuts] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(BLANK_FORM);
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState('All');

    const load = async () => {
        setLoading(true);
        try {
            const list = await getCutTypes();
            setCuts((list || []).map(sanitize));
        } catch (err) {
            console.error(err);
            toast.error('Failed to load cut types');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const openAdd = () => { setForm(BLANK_FORM); setEditing(null); setShowForm(true); };
    const openEdit = (cut) => { setForm({ ...cut }); setEditing(cut.id); setShowForm(true); };
    const closeForm = () => { setShowForm(false); setEditing(null); };

    const handleSave = async () => {
        if (!form.name.trim()) { toast.error('Cut name is required'); return; }
        setSaving(true);
        try {
            if (editing) {
                await updateCutType(editing, form);
                toast.success('Cut type updated');
            } else {
                await createCutType(form);
                toast.success('Cut type created');
            }
            closeForm();
            load();
        } catch (err) {
            toast.error('Save failed: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id, name) => {
        if (!window.confirm(`Delete cut type "${name}"? This cannot be undone.`)) return;
        try {
            await deleteCutType(id);
            toast.success('Cut type deleted');
            load();
        } catch (err) {
            toast.error('Delete failed: ' + err.message);
        }
    };

    const animalGroups = ['All', ...ANIMALS];
    const filtered = filter === 'All' ? cuts : cuts.filter(c => c.animal_type === filter);

    return (
        <div className="butcher-page">
            <div className="butcher-page-header">
                <div>
                    <button className="btn-back" onClick={() => navigate('/butchering/dashboard')}>
                        <MdArrowBack /> Back to Dashboard
                    </button>
                    <h1 className="butcher-page-title" style={{ marginTop: 6 }}>
                        <MdSettings className="title-icon" /> Cut Types Configuration
                    </h1>
                    <p className="butcher-page-subtitle">
                        Define standard cut names, weight benchmarks, shelf life &amp; waste classification by animal type
                    </p>
                </div>
                <div className="butcher-header-actions">
                    <button className="btn btn-secondary btn-md" onClick={load}><MdRefresh /> Refresh</button>
                    <button className="btn btn-primary btn-md" onClick={openAdd}><MdAdd /> Add Cut Type</button>
                </div>
            </div>

            {/* Filter by animal */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                {animalGroups.map(a => (
                    <button
                        key={a}
                        onClick={() => setFilter(a)}
                        style={{
                            padding: '6px 16px',
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid',
                            borderColor: filter === a ? 'var(--color-primary)' : 'var(--color-border)',
                            background: filter === a ? 'var(--color-primary-muted)' : 'transparent',
                            color: filter === a ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: 'var(--font-body)',
                            transition: 'all 0.2s',
                        }}
                    >
                        {a}
                    </button>
                ))}
            </div>

            <div className="butcher-panel">
                {loading ? (
                    <div className="butcher-loading">Loading cut types...</div>
                ) : filtered.length === 0 ? (
                    <div className="butcher-empty">
                        <p>No cut types found. Add your first cut type to start butchering.</p>
                        <button className="btn btn-primary btn-sm" onClick={openAdd}><MdAdd /> Add First Cut Type</button>
                    </div>
                ) : (
                    <div className="butcher-table-wrap">
                        <table className="butcher-table">
                            <thead>
                                <tr>
                                    <th>Cut Name</th>
                                    <th>Animal Type</th>
                                    <th>Std Weight (kg)</th>
                                    <th>Shelf Life</th>
                                    <th>Type</th>
                                    <th>Notes</th>
                                    <th style={{ width: 80 }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(cut => (
                                    <tr key={cut.id} className={cut.is_waste ? 'waste-row' : ''}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <MdContentCut style={{ color: 'var(--color-primary)', opacity: cut.is_waste ? 0.4 : 1 }} />
                                                <strong>{cut.name}</strong>
                                            </div>
                                        </td>
                                        <td><span className="chip-blue">{cut.animal_type}</span></td>
                                        <td>{cut.std_weight_kg ? `${cut.std_weight_kg} kg` : '—'}</td>
                                        <td>{cut.shelf_life_days ? `${cut.shelf_life_days} days` : '—'}</td>
                                        <td>
                                            {cut.is_waste
                                                ? <span className="chip-red">Waste</span>
                                                : <span className="chip-green">Usable Cut</span>
                                            }
                                        </td>
                                        <td style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{cut.notes || '—'}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button className="btn-link-sm" onClick={() => openEdit(cut)}><MdEdit /> Edit</button>
                                                <button className="btn-icon-danger" onClick={() => handleDelete(cut.id, cut.name)} title="Delete"><MdDelete size={14} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add/Edit Modal */}
            {showForm && (
                <div className="butcher-modal-overlay">
                    <div className="butcher-modal" style={{ maxWidth: 500 }}>
                        <div className="modal-head">
                            <h2><MdContentCut /> {editing ? 'Edit Cut Type' : 'Add New Cut Type'}</h2>
                            <button className="modal-close" onClick={closeForm}><MdClose /></button>
                        </div>
                        <div className="modal-body-scroll">
                            <div className="form-row-2">
                                <div className="form-field">
                                    <label>Cut Name *</label>
                                    <input className="form-input" type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Lamb Shoulder" />
                                </div>
                                <div className="form-field">
                                    <label>Animal Type *</label>
                                    <select className="form-select" value={form.animal_type} onChange={e => setForm(p => ({ ...p, animal_type: e.target.value }))}>
                                        {ANIMALS.map(a => <option key={a}>{a}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row-2">
                                <div className="form-field">
                                    <label>Standard Weight (kg)</label>
                                    <input className="form-input" type="number" step="0.1" min="0" value={form.std_weight_kg} onChange={e => setForm(p => ({ ...p, std_weight_kg: Number(e.target.value) }))} placeholder="e.g. 2.5" />
                                </div>
                                <div className="form-field">
                                    <label>Shelf Life (days)</label>
                                    <input className="form-input" type="number" min="0" value={form.shelf_life_days} onChange={e => setForm(p => ({ ...p, shelf_life_days: Number(e.target.value) }))} placeholder="e.g. 5" />
                                </div>
                            </div>
                            <div className="form-field" style={{ marginBottom: 16 }}>
                                <label className="checkbox-row" style={{ cursor: 'pointer', gap: 10, display: 'inline-flex' }}>
                                    <input type="checkbox" checked={form.is_waste} onChange={e => setForm(p => ({ ...p, is_waste: e.target.checked }))} />
                                    <span>Mark as Waste / Bones / Trim (non-usable)</span>
                                </label>
                            </div>
                            <div className="form-field">
                                <label>Notes</label>
                                <textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes..." />
                            </div>
                        </div>
                        <div className="modal-foot">
                            <button className="btn btn-secondary btn-md" onClick={closeForm}>Cancel</button>
                            <button className="btn btn-primary btn-md" onClick={handleSave} disabled={saving}>
                                <MdSave /> {saving ? 'Saving...' : (editing ? 'Update Cut Type' : 'Add Cut Type')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CutTypesAdmin;
