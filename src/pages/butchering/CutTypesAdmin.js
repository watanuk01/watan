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
    MdExpandMore,
    MdExpandLess,
} from 'react-icons/md';
import {
    getAnimals,
    createAnimal,
    updateAnimal,
    deleteAnimal,
    ANIMAL_TYPES,
} from '../../services/butcheringService';
import toast from 'react-hot-toast';
import './ButcheringModule.css';

// ─── Blank form templates ───
const BLANK_CUT = { name: '', std_weight_kg: '', shelf_life_days: 5, is_waste: false, notes: '' };
const BLANK_ANIMAL = {
    name: '',
    animal_type: 'Lamb',
    base_weight: '',
    base_unit: 'kg',
    allowed_butchering_quantities: '',
    notes: '',
    cut_types: [],
};

const CutTypesAdmin = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [animals, setAnimals] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);   // animal id when editing
    const [form, setForm] = useState({ ...BLANK_ANIMAL });
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState('All');
    const [expandedCard, setExpandedCard] = useState(null);
    const [customAnimalType, setCustomAnimalType] = useState('');
    const [showCustomType, setShowCustomType] = useState(false);

    // ── Load animals ──
    const load = async () => {
        setLoading(true);
        try {
            const list = await getAnimals();
            setAnimals(list || []);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load animals');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    // ── Collect unique animal types from data ──
    const allTypes = [...new Set([
        ...ANIMAL_TYPES,
        ...animals.map(a => a.animal_type).filter(Boolean),
    ])].sort();

    const animalGroups = ['All', ...allTypes];
    const filtered = filter === 'All' ? animals : animals.filter(a => a.animal_type === filter);

    // ── Modal open/close ──
    const openAdd = () => {
        setForm({ ...BLANK_ANIMAL });
        setEditing(null);
        setShowCustomType(false);
        setCustomAnimalType('');
        setShowForm(true);
    };

    const openEdit = (animal) => {
        setForm({
            name: animal.name || '',
            animal_type: animal.animal_type || 'Lamb',
            base_weight: animal.base_weight || '',
            base_unit: 'kg',
            allowed_butchering_quantities: (animal.allowed_butchering_quantities || []).join(', '),
            notes: animal.notes || '',
            cut_types: (animal.cut_types || []).map(ct => ({ ...ct })),
        });
        setEditing(animal.id);
        setShowCustomType(!ANIMAL_TYPES.includes(animal.animal_type));
        setCustomAnimalType(!ANIMAL_TYPES.includes(animal.animal_type) ? animal.animal_type : '');
        setShowForm(true);
    };

    const closeForm = () => { setShowForm(false); setEditing(null); };

    // ── Form field handlers ──
    const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    // ── Cut type handlers ──
    const addCutType = () => {
        setForm(prev => ({
            ...prev,
            cut_types: [...prev.cut_types, { ...BLANK_CUT }],
        }));
    };

    const updateCut = (idx, field, value) => {
        setForm(prev => ({
            ...prev,
            cut_types: prev.cut_types.map((ct, i) =>
                i === idx ? { ...ct, [field]: value } : ct
            ),
        }));
    };

    const removeCut = (idx) => {
        setForm(prev => ({
            ...prev,
            cut_types: prev.cut_types.filter((_, i) => i !== idx),
        }));
    };

    // ── Yield calculation ──
    const totalCutWeight = form.cut_types.reduce((s, ct) => s + (Number(ct.std_weight_kg) || 0), 0);
    const baseWeight = Number(form.base_weight) || 0;
    const yieldPct = baseWeight > 0 ? ((totalCutWeight / baseWeight) * 100).toFixed(1) : '—';
    const wasteWeight = form.cut_types.filter(ct => ct.is_waste).reduce((s, ct) => s + (Number(ct.std_weight_kg) || 0), 0);
    const usableWeight = totalCutWeight - wasteWeight;

    // ── Save ──
    const handleSave = async () => {
        if (!form.name.trim()) { toast.error('Animal name is required'); return; }
        if (!form.base_weight || Number(form.base_weight) <= 0) { toast.error('Base weight is required'); return; }

        const animalType = showCustomType ? customAnimalType.trim() : form.animal_type;
        if (!animalType) { toast.error('Animal type is required'); return; }

        // Validate cut types names
        const invalidCuts = form.cut_types.filter(ct => !ct.name.trim());
        if (invalidCuts.length > 0) { toast.error('All cut types need a name'); return; }

        setSaving(true);
        try {
            const payload = {
                ...form,
                animal_type: animalType,
                base_unit: 'kg',
                allowed_butchering_quantities: String(form.allowed_butchering_quantities || '')
                    .split(',').map(value => Number(value.trim())).filter(value => Number.isFinite(value) && value > 0),
            };

            if (editing) {
                await updateAnimal(editing, payload);
                toast.success('Animal updated successfully');
            } else {
                await createAnimal(payload);
                toast.success('Animal created successfully');
            }
            closeForm();
            load();
        } catch (err) {
            toast.error('Save failed: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    // ── Delete ──
    const handleDelete = async (id, name) => {
        if (!window.confirm(`Delete "${name}" and all its cut types? This cannot be undone.`)) return;
        try {
            await deleteAnimal(id);
            toast.success('Animal deleted');
            load();
        } catch (err) {
            toast.error('Delete failed: ' + err.message);
        }
    };

    // ── Toggle card expansion ──
    const toggleExpand = (id) => setExpandedCard(prev => prev === id ? null : id);

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
                        <MdSettings className="title-icon" /> Animal & Cut Types Configuration
                    </h1>
                    <p className="butcher-page-subtitle">
                        Define animals with base weight and their cut types — like recipes with ingredients
                    </p>
                </div>
                <div className="butcher-header-actions">
                    <button className="btn btn-secondary btn-md" onClick={load}><MdRefresh /> Refresh</button>
                    <button className="btn btn-primary btn-md" onClick={openAdd}><MdAdd /> Add Animal</button>
                </div>
            </div>

            {/* Filter by animal type */}
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

            {/* ── Animal Cards Grid ── */}
            <div className="butcher-panel" style={{ background: 'transparent', border: 'none', padding: 0 }}>
                {loading ? (
                    <div className="butcher-loading">Loading animals...</div>
                ) : filtered.length === 0 ? (
                    <div className="butcher-empty">
                        <p>No animals defined yet. Add your first animal to start configuring cut types.</p>
                        <button className="btn btn-primary btn-sm" onClick={openAdd}><MdAdd /> Add First Animal</button>
                    </div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                        gap: 'var(--space-4)',
                    }}>
                        {filtered.map(animal => {
                            const cuts = animal.cut_types || [];
                            const totalWeight = cuts.reduce((s, c) => s + (Number(c.std_weight_kg) || 0), 0);
                            const waste = cuts.filter(c => c.is_waste).reduce((s, c) => s + (Number(c.std_weight_kg) || 0), 0);
                            const usable = totalWeight - waste;
                            const yld = animal.base_weight > 0 ? ((usable / animal.base_weight) * 100).toFixed(0) : '—';
                            const isExpanded = expandedCard === animal.id;

                            return (
                                <div key={animal.id} style={{
                                    background: 'var(--color-surface)',
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-lg)',
                                    overflow: 'hidden',
                                    transition: 'all 0.25s',
                                }}>
                                    {/* Card Header */}
                                    <div style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: 'var(--space-4)', borderBottom: '1px solid var(--color-border)',
                                        cursor: 'pointer',
                                    }} onClick={() => toggleExpand(animal.id)}>
                                        <div>
                                            <div style={{
                                                fontFamily: 'var(--font-heading)', fontWeight: 700,
                                                color: 'var(--color-text-primary)', fontSize: 'var(--text-md)',
                                                display: 'flex', alignItems: 'center', gap: 8,
                                            }}>
                                                <MdContentCut style={{ color: 'var(--color-primary)' }} />
                                                {animal.name}
                                            </div>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                                                <span className="chip-blue" style={{ marginRight: 6 }}>{animal.animal_type}</span>
                                                Base: {animal.base_weight} {animal.base_unit}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {isExpanded ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
                                        </div>
                                    </div>

                                    {/* Card Body — KPI row */}
                                    <div style={{
                                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
                                        padding: 'var(--space-3) var(--space-4)',
                                        gap: 'var(--space-2)',
                                    }}>
                                        {[
                                            { label: 'Cut Types', value: cuts.length },
                                            { label: 'Usable', value: `${usable.toFixed(1)} kg` },
                                            { label: 'Waste', value: `${waste.toFixed(1)} kg` },
                                            { label: 'Yield', value: `${yld}%`, color: Number(yld) >= 80 ? '#22c55e' : Number(yld) >= 60 ? '#f59e0b' : '#ef4444' },
                                        ].map((kpi, i) => (
                                            <div key={i} style={{ textAlign: 'center' }}>
                                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{kpi.label}</div>
                                                <div style={{ fontWeight: 700, color: kpi.color || 'var(--color-text-primary)', fontSize: 'var(--text-sm)' }}>{kpi.value}</div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Expanded — Cut Types List */}
                                    {isExpanded && (
                                        <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
                                            <div style={{
                                                borderTop: '1px solid var(--color-border)',
                                                paddingTop: 'var(--space-3)',
                                            }}>
                                                {cuts.length === 0 ? (
                                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-3)' }}>
                                                        No cut types defined
                                                    </div>
                                                ) : (
                                                    <table className="butcher-table" style={{ fontSize: 'var(--text-sm)' }}>
                                                        <thead>
                                                            <tr>
                                                                <th>Cut Name</th>
                                                                <th>Weight (kg)</th>
                                                                <th>Shelf Life</th>
                                                                <th>Type</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {cuts.map((cut, idx) => (
                                                                <tr key={idx} className={cut.is_waste ? 'waste-row' : ''}>
                                                                    <td>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                            <MdContentCut style={{ color: 'var(--color-primary)', opacity: cut.is_waste ? 0.4 : 1, fontSize: 14 }} />
                                                                            <strong>{cut.name}</strong>
                                                                        </div>
                                                                    </td>
                                                                    <td>{cut.std_weight_kg ? `${cut.std_weight_kg} kg` : '—'}</td>
                                                                    <td>{cut.shelf_life_days ? `${cut.shelf_life_days} days` : '—'}</td>
                                                                    <td>
                                                                        {cut.is_waste
                                                                            ? <span className="chip-red">Waste</span>
                                                                            : <span className="chip-green">Usable</span>
                                                                        }
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}

                                                {/* Card Actions */}
                                                <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-3)', justifyContent: 'flex-end' }}>
                                                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(animal)}>
                                                        <MdEdit /> Edit
                                                    </button>
                                                    <button className="btn btn-sm" onClick={() => handleDelete(animal.id, animal.name)}
                                                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                                                        <MdDelete /> Delete
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ═══════════════════════════════════════════
                ADD/EDIT ANIMAL MODAL
            ═══════════════════════════════════════════ */}
            {showForm && (
                <div className="butcher-modal-overlay">
                    <div className="butcher-modal" style={{ maxWidth: 700, maxHeight: '92vh' }}>
                        <div className="modal-head">
                            <h2><MdContentCut /> {editing ? 'Edit Animal & Cuts' : 'Add New Animal'}</h2>
                            <button className="modal-close" onClick={closeForm}><MdClose /></button>
                        </div>
                        <div className="modal-body-scroll" style={{ maxHeight: 'calc(92vh - 130px)', overflowY: 'auto' }}>
                            {/* ── Section 1: Animal Details ── */}
                            <div style={{
                                background: 'var(--color-bg-dark)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-4)',
                                marginBottom: 'var(--space-5)',
                                border: '1px solid var(--color-border)',
                            }}>
                                <h3 style={{
                                    fontSize: 'var(--text-md)', fontFamily: 'var(--font-heading)',
                                    color: 'var(--color-primary)', marginBottom: 'var(--space-4)',
                                    display: 'flex', alignItems: 'center', gap: 8,
                                }}>
                                    🐑 Animal Details
                                </h3>

                                <div className="form-row-2">
                                    <div className="form-field">
                                        <label>Animal Name *</label>
                                        <input
                                            className="form-input"
                                            type="text"
                                            value={form.name}
                                            onChange={e => updateField('name', e.target.value)}
                                            placeholder="e.g. Whole Lamb, Chicken Box"
                                        />
                                    </div>
                                    <div className="form-field">
                                        <label>Animal Type *</label>
                                        {showCustomType ? (
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <input
                                                    className="form-input"
                                                    type="text"
                                                    value={customAnimalType}
                                                    onChange={e => setCustomAnimalType(e.target.value)}
                                                    placeholder="Enter new animal type"
                                                    style={{ flex: 1 }}
                                                />
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => { setShowCustomType(false); setCustomAnimalType(''); }}
                                                    style={{ whiteSpace: 'nowrap' }}
                                                >
                                                    ← List
                                                </button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <select
                                                    className="form-select"
                                                    value={form.animal_type}
                                                    onChange={e => updateField('animal_type', e.target.value)}
                                                    style={{ flex: 1 }}
                                                >
                                                    {allTypes.map(a => <option key={a}>{a}</option>)}
                                                </select>
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => setShowCustomType(true)}
                                                    style={{ whiteSpace: 'nowrap' }}
                                                    title="Create new type"
                                                >
                                                    + New
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="form-row-2">
                                    <div className="form-field">
                                        <label>Base Batch Weight (kg) *</label>
                                        <input className="form-input" type="number" step="0.1" min="0" value={form.base_weight}
                                            onChange={e => updateField('base_weight', e.target.value)} placeholder="e.g. 56" />
                                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4, display: 'block' }}>
                                            Every cut weight below is defined for this base kg batch and scales proportionally.
                                        </span>
                                    </div>
                                    <div className="form-field">
                                        <label>Notes</label>
                                        <input
                                            className="form-input"
                                            type="text"
                                            value={form.notes}
                                            onChange={e => updateField('notes', e.target.value)}
                                            placeholder="Optional notes..."
                                        />
                                    </div>
                                </div>
                                <div className="form-field" style={{ marginTop: 'var(--space-3)' }}>
                                    <label>Allowed Butchering Quantities (kg, optional)</label>
                                    <input className="form-input" value={form.allowed_butchering_quantities}
                                        onChange={e => updateField('allowed_butchering_quantities', e.target.value)} placeholder="e.g. 5, 10, 20, 40" />
                                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4, display: 'block' }}>
                                        These suggested kg quantities appear in the butchering order, just like allowed production quantities in cooked-meat recipes.
                                    </span>
                                </div>
                            </div>

                            {/* ── Section 2: Cut Types ── */}
                            <div style={{
                                background: 'var(--color-bg-dark)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-4)',
                                border: '1px solid var(--color-border)',
                            }}>
                                <div style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    marginBottom: 'var(--space-4)',
                                }}>
                                    <h3 style={{
                                        fontSize: 'var(--text-md)', fontFamily: 'var(--font-heading)',
                                        color: 'var(--color-primary)',
                                        display: 'flex', alignItems: 'center', gap: 8,
                                    }}>
                                        🔪 Cut Types ({form.cut_types.length})
                                    </h3>
                                    <button className="btn btn-secondary btn-sm" onClick={addCutType}>
                                        <MdAdd /> Add Cut
                                    </button>
                                </div>

                                {form.cut_types.length === 0 ? (
                                    <div style={{
                                        textAlign: 'center', padding: 'var(--space-6)',
                                        color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)',
                                    }}>
                                        <MdContentCut size={36} style={{ opacity: 0.2, marginBottom: 8, display: 'block', margin: '0 auto 8px' }} />
                                        No cut types yet. Click "Add Cut" to define the cuts from this animal.
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                        {form.cut_types.map((cut, idx) => (
                                            <div key={idx} style={{
                                                display: 'grid',
                                                gridTemplateColumns: '2fr 90px 80px auto 32px',
                                                gap: 'var(--space-2)',
                                                alignItems: 'center',
                                                padding: 'var(--space-3)',
                                                background: cut.is_waste ? 'rgba(239,68,68,0.05)' : 'var(--color-surface)',
                                                borderRadius: 'var(--radius-md)',
                                                border: `1px solid ${cut.is_waste ? 'rgba(239,68,68,0.2)' : 'var(--color-border)'}`,
                                                transition: 'all 0.2s',
                                            }}>
                                                <input
                                                    className="form-input"
                                                    type="text"
                                                    value={cut.name}
                                                    onChange={e => updateCut(idx, 'name', e.target.value)}
                                                    placeholder="Cut name, e.g. Lamb Legs"
                                                    style={{ fontSize: 'var(--text-sm)' }}
                                                />
                                                <input
                                                    className="form-input"
                                                    type="number"
                                                    step="0.1"
                                                    min="0"
                                                    value={cut.std_weight_kg}
                                                    onChange={e => updateCut(idx, 'std_weight_kg', e.target.value)}
                                                    placeholder="kg"
                                                    style={{ fontSize: 'var(--text-sm)', textAlign: 'center' }}
                                                    title="Expected weight (kg)"
                                                />
                                                <input
                                                    className="form-input"
                                                    type="number"
                                                    min="0"
                                                    value={cut.shelf_life_days}
                                                    onChange={e => updateCut(idx, 'shelf_life_days', e.target.value)}
                                                    placeholder="days"
                                                    style={{ fontSize: 'var(--text-sm)', textAlign: 'center' }}
                                                    title="Shelf life (days)"
                                                />
                                                <label style={{
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    cursor: 'pointer', fontSize: 'var(--text-xs)',
                                                    color: cut.is_waste ? '#ef4444' : 'var(--color-text-muted)',
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={cut.is_waste}
                                                        onChange={e => updateCut(idx, 'is_waste', e.target.checked)}
                                                    />
                                                    Waste
                                                </label>
                                                <button
                                                    onClick={() => removeCut(idx)}
                                                    style={{
                                                        background: 'none', border: 'none',
                                                        color: 'var(--color-text-muted)', cursor: 'pointer',
                                                        fontSize: 16, padding: 4, borderRadius: 'var(--radius-sm)',
                                                        transition: 'all 0.2s',
                                                    }}
                                                    title="Remove cut"
                                                    onMouseEnter={e => { e.target.style.color = '#ef4444'; e.target.style.background = 'rgba(239,68,68,0.1)'; }}
                                                    onMouseLeave={e => { e.target.style.color = 'var(--color-text-muted)'; e.target.style.background = 'none'; }}
                                                >
                                                    <MdDelete />
                                                </button>
                                            </div>
                                        ))}

                                        {/* Column labels */}
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: '2fr 90px 80px auto 32px',
                                            gap: 'var(--space-2)',
                                            padding: '0 var(--space-3)',
                                            fontSize: 'var(--text-xs)',
                                            color: 'var(--color-text-muted)',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                        }}>
                                            <span>Name</span>
                                            <span style={{ textAlign: 'center' }}>Weight (kg)</span>
                                            <span style={{ textAlign: 'center' }}>Shelf Life</span>
                                            <span></span>
                                            <span></span>
                                        </div>
                                    </div>
                                )}

                                {/* Yield Summary Bar */}
                                {form.cut_types.length > 0 && (
                                    <div style={{
                                        marginTop: 'var(--space-4)',
                                        padding: 'var(--space-3) var(--space-4)',
                                        background: 'var(--color-surface)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--color-border)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        flexWrap: 'wrap',
                                        gap: 'var(--space-3)',
                                        fontSize: 'var(--text-sm)',
                                    }}>
                                        <div>
                                            <span style={{ color: 'var(--color-text-muted)' }}>Base Weight: </span>
                                            <strong>{baseWeight || '—'} {form.base_unit}</strong>
                                        </div>
                                        <div>
                                            <span style={{ color: 'var(--color-text-muted)' }}>Total Cuts: </span>
                                            <strong>{totalCutWeight.toFixed(1)} kg</strong>
                                        </div>
                                        <div>
                                            <span style={{ color: '#22c55e' }}>Usable: </span>
                                            <strong style={{ color: '#22c55e' }}>{usableWeight.toFixed(1)} kg</strong>
                                        </div>
                                        <div>
                                            <span style={{ color: '#ef4444' }}>Waste: </span>
                                            <strong style={{ color: '#ef4444' }}>{wasteWeight.toFixed(1)} kg</strong>
                                        </div>
                                        <div>
                                            <span style={{ color: 'var(--color-text-muted)' }}>Yield: </span>
                                            <strong style={{
                                                color: Number(yieldPct) >= 80 ? '#22c55e' : Number(yieldPct) >= 60 ? '#f59e0b' : '#ef4444',
                                            }}>{yieldPct}%</strong>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="modal-foot">
                            <button className="btn btn-secondary btn-md" onClick={closeForm}>Cancel</button>
                            <button className="btn btn-primary btn-md" onClick={handleSave} disabled={saving}>
                                <MdSave /> {saving ? 'Saving...' : (editing ? 'Update Animal' : 'Create Animal')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CutTypesAdmin;
