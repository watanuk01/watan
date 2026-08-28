import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    MdContentCut,
    MdAdd,
    MdDelete,
    MdSave,
    MdArrowBack,
    MdQrCodeScanner,
    MdTrendingUp,
    MdCheckCircle,
    MdWarning,
    MdPrint,
    MdScale,
    MdStore,
    MdCalendarToday,
    MdInventory2,
    MdInfo,
} from 'react-icons/md';
import {
    getButcherInventory,
    getCutTypes,
    getAnimals,
    createButcheringOrder,
} from '../../services/butcheringService';
import QrCodeSvg from '../../components/ui/QrCodeSvg';
import toast from 'react-hot-toast';
import './ButcheringModule.css';

const safeNum = (v, fallback = 0) => { const n = Number(v); return isNaN(n) ? fallback : n; };

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

let _rowCounter = 1;
const newRowId = () => String(_rowCounter++);

const buildBatchQrText = ({ batchNo, cutName, weightKg, isWaste, parentBatchNo, parentProduct, parentWeight, vendor, butcherName, date, yieldPct, expiry, orderNo }) => {
    return [
        `WATAN CENTRAL KITCHEN`,
        `--- BATCH TRACEABILITY ---`,
        `Batch: ${batchNo}`,
        `Product: ${cutName}`,
        `Weight: ${weightKg} kg`,
        `Type: ${isWaste ? 'Waste/Bones' : 'Usable Cut'}`,
        ``,
        `--- GENEALOGY FLOW ---`,
        `Vendor: ${vendor}`,
        `  > Parent Batch: ${parentBatchNo}`,
        `    Product: ${parentProduct}`,
        `    Weight: ${parentWeight} kg`,
        `  > Butchering: ${orderNo || 'Pending'}`,
        `    Butcher: ${butcherName}`,
        `    Date: ${date}`,
        `    Yield: ${yieldPct || '—'}%`,
        `  > This Cut: ${batchNo}`,
        `    ${cutName} - ${weightKg} kg`,
        ``,
        `Expiry: ${expiry || '—'}`,
    ].join('\n');
};

const NewButcheringOrder = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const preselectedId = searchParams.get('source');

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [batches, setBatches] = useState([]);
    const [cutMaster, setCutMaster] = useState([]);
    const [animals, setAnimals] = useState([]);
    const [selectedBatchId, setSelectedBatchId] = useState('');
    const [selectedBatch, setSelectedBatch] = useState(null);
    const [butcherName, setButcherName] = useState('Central Kitchen Butcher');
    const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
    const [notes, setNotes] = useState('');
    const [cuts, setCuts] = useState([]);
    const [createdOrder, setCreatedOrder] = useState(null);
    const [amountToButcher, setAmountToButcher] = useState('');
    const [showAllCuts, setShowAllCuts] = useState(false);

    // Detect animal type from batch item name
    const detectAnimalType = (batch) => {
        if (!batch) return null;
        if (batch.animal_type) return batch.animal_type;
        const name = (batch.item_name || '').toLowerCase();
        if (name.includes('chicken')) return 'Chicken';
        if (name.includes('beef') || name.includes('cow')) return 'Beef';
        if (name.includes('mutton')) return 'Mutton';
        if (name.includes('goat')) return 'Goat';
        if (name.includes('lamb') || name.includes('sheep')) return 'Lamb';
        if (name.includes('pork')) return 'Pork';
        if (name.includes('turkey')) return 'Turkey';
        if (name.includes('duck')) return 'Duck';
        if (name.includes('prawn') || name.includes('fish') || name.includes('seafood') ||
            name.includes('salmon') || name.includes('cod')) return 'Seafood';
        return null;
    };

    // Find matching animal master for proportional calculations
    const findMatchingAnimal = (batch) => {
        if (!batch) return null;
        const batchName = (batch.item_name || '').toLowerCase();
        // First try exact name match
        let match = animals.find(a => batchName.includes(a.name.toLowerCase()));
        if (match) return match;
        // Then try animal_type match
        const animalType = detectAnimalType(batch);
        if (animalType) {
            match = animals.find(a => a.animal_type === animalType);
        }
        return match || null;
    };

    // Calculate proportional cuts based on amount to butcher
    const applyProportionalCuts = (batch, butcherAmount) => {
        const matchedAnimal = findMatchingAnimal(batch);
        const parentNo = batch.batch_number || batch.id;

        if (matchedAnimal && matchedAnimal.cut_types && matchedAnimal.cut_types.length > 0) {
            const baseWeight = safeNum(matchedAnimal.base_weight, 1);
            const ratio = safeNum(butcherAmount, 0) / baseWeight;

            const rows = matchedAnimal.cut_types.map((ct, i) => {
                const stdWeight = safeNum(ct.std_weight_kg, 0);
                const proportionalWeight = Math.round(stdWeight * ratio * 100) / 100;
                const code = (ct.name || 'CUT').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();

                return {
                    id: newRowId(),
                    cut_name: ct.name,
                    weight_kg: proportionalWeight > 0 ? proportionalWeight : 0,
                    is_waste: Boolean(ct.is_waste),
                    shelf_life_days: safeNum(ct.shelf_life_days, 5),
                    child_batch_no: `${parentNo}-${code}-${i + 1}`,
                };
            });

            setCuts(rows);
        } else {
            // Fallback to cut types from flat collection
            const animalType = detectAnimalType(batch);
            const filtered = animalType
                ? cutMaster.filter(c => (c.animal_type || '').toLowerCase() === animalType.toLowerCase())
                : cutMaster;
            const listToUse = filtered.length > 0 ? filtered : cutMaster.slice(0, 5);

            const totalStdWeight = listToUse.reduce((s, c) => s + safeNum(c.std_weight_kg, 2), 0);
            const amt = safeNum(butcherAmount, 0);

            const rows = listToUse.map((c, i) => {
                const stdWeight = safeNum(c.std_weight_kg, 2);
                const proportion = totalStdWeight > 0 ? stdWeight / totalStdWeight : 1 / listToUse.length;
                const propWeight = Math.round(amt * proportion * 100) / 100;
                const code = (c.name || 'CUT').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();

                return {
                    id: newRowId(),
                    cut_name: c.name,
                    weight_kg: propWeight > 0 ? propWeight : 0,
                    is_waste: Boolean(c.is_waste),
                    shelf_life_days: safeNum(c.shelf_life_days, 5),
                    child_batch_no: `${parentNo}-${code}-${i + 1}`,
                };
            });

            setCuts(rows);
        }
    };

    const load = async () => {
        setLoading(true);
        try {
            const [batchList, cutList, animalList] = await Promise.all([
                getButcherInventory(),
                getCutTypes(),
                getAnimals(),
            ]);

            const sanitizedBatches = (batchList || []).map(sanitize);
            const sanitizedCuts = (cutList || []).map(sanitize);

            setBatches(sanitizedBatches);
            setCutMaster(sanitizedCuts);
            setAnimals(animalList || []);

            let initialBatch = sanitizedBatches[0] || null;
            if (preselectedId) {
                initialBatch = sanitizedBatches.find(b => b.id === preselectedId) || initialBatch;
            }

            if (initialBatch) {
                setSelectedBatchId(initialBatch.id);
                setSelectedBatch(initialBatch);
                const availableWeight = safeNum(initialBatch.weight_kg || initialBatch.quantity || initialBatch.initial_quantity, 10);
                setAmountToButcher(String(availableWeight));
                // Apply proportional cuts after animals load
                setTimeout(() => {
                    applyProportionalCuts(initialBatch, availableWeight);
                }, 0);
            }
        } catch (err) {
            console.error('Load error:', err);
            toast.error('Failed to load batch data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // When amount to butcher changes, recalculate proportional cuts
    const handleAmountChange = (val) => {
        setAmountToButcher(val);
        if (selectedBatch && safeNum(val) > 0) {
            applyProportionalCuts(selectedBatch, safeNum(val));
        }
    };

    const handleBatchChange = (id) => {
        setSelectedBatchId(id);
        const found = batches.find(b => b.id === id);
        setSelectedBatch(found || null);
        if (found) {
            const availableWeight = safeNum(found.weight_kg || found.quantity || found.initial_quantity, 10);
            setAmountToButcher(String(availableWeight));
            applyProportionalCuts(found, availableWeight);
        }
    };

    const currentAnimal = detectAnimalType(selectedBatch);
    const matchedAnimalMaster = findMatchingAnimal(selectedBatch);

    const getAvailableCutTypes = () => {
        if (showAllCuts || !currentAnimal) return cutMaster;
        const filtered = cutMaster.filter(c => {
            const cutAnimal = (c.animal_type || '').toLowerCase();
            const targetAnimal = currentAnimal.toLowerCase();
            if (targetAnimal === 'mutton' || targetAnimal === 'lamb') {
                return cutAnimal === 'mutton' || cutAnimal === 'lamb' || cutAnimal === 'other';
            }
            return cutAnimal === targetAnimal || cutAnimal === 'other';
        });
        return filtered.length > 0 ? filtered : cutMaster;
    };

    // Metrics
    const parentWeight = safeNum(selectedBatch?.weight_kg || selectedBatch?.quantity || selectedBatch?.initial_quantity, 0);
    const butcherAmt = safeNum(amountToButcher, 0);
    const usableWeight = cuts.filter(c => !c.is_waste).reduce((s, c) => s + safeNum(c.weight_kg), 0);
    const wasteWeight = cuts.filter(c => c.is_waste).reduce((s, c) => s + safeNum(c.weight_kg), 0);
    const allocated = usableWeight + wasteWeight;
    const remaining = Math.max(0, butcherAmt - allocated);
    const yieldPct = butcherAmt > 0 ? Math.round((usableWeight / butcherAmt) * 1000) / 10 : 0;
    const isOverAllocated = allocated > butcherAmt + 0.05;

    const addRow = () => {
        const available = getAvailableCutTypes();
        const defaultCut = available[0] || cutMaster[0];
        const parentNo = selectedBatch?.batch_number || 'BAT';
        const code = (defaultCut?.name || 'CUT').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
        const unallocatedLeft = Math.max(0, butcherAmt - allocated);
        const initialWeight = unallocatedLeft > 0 ? Math.min(2.5, Math.round(unallocatedLeft * 10) / 10) : 1.0;

        setCuts(p => [...p, {
            id: newRowId(),
            cut_name: defaultCut?.name || 'Cut',
            weight_kg: initialWeight,
            is_waste: Boolean(defaultCut?.is_waste),
            shelf_life_days: safeNum(defaultCut?.shelf_life_days, 5),
            child_batch_no: `${parentNo}-${code}-${p.length + 1}`,
        }]);
    };

    const removeRow = (id) => {
        if (cuts.length <= 1) { toast.error('At least one cut row is required'); return; }
        setCuts(p => p.filter(c => c.id !== id));
    };

    const updateRow = (id, field, value) => {
        setCuts(p => p.map(c => {
            if (c.id !== id) return c;
            const updated = { ...c, [field]: value };
            if (field === 'cut_name') {
                const master = cutMaster.find(m => m.name === value);
                if (master) {
                    updated.is_waste = Boolean(master.is_waste);
                    updated.shelf_life_days = safeNum(master.shelf_life_days, c.shelf_life_days);
                }
                const parentNo = selectedBatch?.batch_number || 'BAT';
                const code = value.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
                updated.child_batch_no = `${parentNo}-${code}`;
            }
            return updated;
        }));
    };

    const handleSave = async () => {
        if (!selectedBatch) { toast.error('Select a source batch first'); return; }
        if (cuts.length === 0) { toast.error('Add at least one cut output row'); return; }
        if (isOverAllocated) {
            toast.error(`Cannot save: Total allocated (${allocated.toFixed(1)} kg) exceeds amount to butcher (${butcherAmt} kg)!`);
            return;
        }
        if (usableWeight <= 0) {
            toast.error('At least one usable cut with weight > 0 kg is required');
            return;
        }
        setSaving(true);
        try {
            const result = await createButcheringOrder({ sourceBatch: selectedBatch, butcherName, date, cuts, notes });
            toast.success(`Order ${result.order_no} created — ${result.child_batches?.length || 0} child batches generated!`);
            setCreatedOrder(result);
        } catch (err) {
            toast.error('Failed to create order: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    // ═══════════════════════════════════════════
    // SUCCESS SCREEN
    // ═══════════════════════════════════════════
    if (createdOrder) {
        const order = createdOrder;
        const childBatches = order.child_batches || [];

        return (
            <div className="butcher-page">
                <div className="butcher-page-header">
                    <div>
                        <h1 className="butcher-page-title"><MdCheckCircle className="title-icon" style={{ color: '#22c55e' }} /> Butchering Complete</h1>
                    </div>
                </div>

                <div className="butcher-panel" style={{ textAlign: 'center', padding: 40 }}>
                    <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
                    <h2 style={{ color: 'var(--color-primary)', marginBottom: 8, fontFamily: 'var(--font-heading)' }}>
                        Order {order.order_no}
                    </h2>
                    <p style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>
                        {childBatches.length} child batches created • Yield: {order.yield_pct}%
                    </p>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                        Input: {order.input_weight_kg} kg → Usable: {order.output_weight_kg} kg • Waste: {order.waste_weight_kg} kg
                    </p>

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
                        <button className="btn btn-primary btn-md" onClick={() => { setCreatedOrder(null); load(); }}>
                            <MdAdd /> New Butchering Order
                        </button>
                        <button className="btn btn-secondary btn-md" onClick={() => navigate('/butchering/history')}>
                            View History
                        </button>
                    </div>
                </div>

                {/* QR Codes */}
                {childBatches.length > 0 && (
                    <div className="butcher-panel" style={{ marginTop: 24 }}>
                        <h3 className="butcher-panel-title"><MdQrCodeScanner /> Generated QR Labels</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginTop: 12 }}>
                            {childBatches.map(batch => (
                                <div key={batch.id} style={{
                                    background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-md)', padding: 16, textAlign: 'center',
                                }}>
                                    <QrCodeSvg value={batch.qr_code_data || batch.batch_number} size={140} />
                                    <div style={{ marginTop: 8, fontWeight: 700, fontSize: 13, color: 'var(--color-primary)' }}>
                                        {batch.batch_number}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                        {batch.cut_name || batch.item_name} — {batch.quantity} kg
                                        {batch.is_waste && <span style={{ color: '#ef4444' }}> (Waste)</span>}
                                    </div>
                                    <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
                                        onClick={() => {
                                            const el = document.createElement('a');
                                            const svg = document.querySelector(`[data-batch="${batch.id}"]`);
                                            if (svg) { /* Print logic can be added */ }
                                            toast.success('Print from browser print dialog');
                                            window.print();
                                        }}>
                                        <MdPrint size={12} /> Print Label
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ═══════════════════════════════════════════
    // MAIN FORM
    // ═══════════════════════════════════════════
    return (
        <div className="butcher-page">
            <div className="butcher-page-header">
                <div>
                    <button className="btn-back" onClick={() => navigate('/butchering/dashboard')}>
                        <MdArrowBack /> Back to Dashboard
                    </button>
                    <h1 className="butcher-page-title" style={{ marginTop: 6 }}>
                        <MdContentCut className="title-icon" /> New Butchering Order
                    </h1>
                    <p className="butcher-page-subtitle">
                        Select meat from inventory, choose amount to butcher — cut weights auto-calculated from Cut Types Admin
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="butcher-loading">Loading raw meat batches and cut types...</div>
            ) : batches.length === 0 ? (
                <div className="butcher-panel" style={{ textAlign: 'center', padding: '40px 20px' }}>
                    <MdWarning size={48} color="var(--color-warning)" style={{ marginBottom: 12 }} />
                    <h3 style={{ color: 'var(--color-text-primary)' }}>No Meat Available for Butchering</h3>
                    <p style={{ color: 'var(--color-text-muted)', marginBottom: 20 }}>
                        Receive a meat purchase order first, then the meat will appear here.
                    </p>
                    <button className="btn btn-primary btn-md" onClick={() => navigate('/butchering/purchase-order')}>
                        Create Meat Purchase Order
                    </button>
                </div>
            ) : (
                <>
                    {/* Section 1: Source Batch & Butcher Details */}
                    <div className="butcher-panel">
                        <h3 className="butcher-panel-title">1. Select Source Batch & Butcher Details</h3>
                        <div className="form-row-3">
                            <div className="form-field">
                                <label>Source Meat Batch *</label>
                                <select className="form-select" value={selectedBatchId} onChange={e => handleBatchChange(e.target.value)}>
                                    {batches.map(b => (
                                        <option key={b.id} value={b.id}>
                                            {b.batch_number || b.id} — {b.item_name} ({safeNum(b.weight_kg || b.quantity || b.initial_quantity, 10)} kg)
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-field">
                                <label>Butcher Name</label>
                                <input className="form-input" type="text" value={butcherName}
                                    onChange={e => setButcherName(e.target.value)} placeholder="Butcher name" />
                            </div>
                            <div className="form-field">
                                <label>Date</label>
                                <input className="form-input" type="date" value={date}
                                    onChange={e => setDate(e.target.value)} />
                            </div>
                        </div>

                        {/* Source Batch Info Cards */}
                        {selectedBatch && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 16 }}>
                                {[
                                    { icon: <MdInventory2 />, label: 'Available', value: `${parentWeight} kg`, color: 'var(--color-success)' },
                                    { icon: <MdStore />, label: 'Vendor', value: selectedBatch.vendor_name || selectedBatch.supplier || '—' },
                                    { icon: <MdCalendarToday />, label: 'Animal Type', value: currentAnimal || 'Unknown', color: 'var(--color-primary)' },
                                    ...(matchedAnimalMaster ? [{ icon: <MdInfo />, label: 'Template', value: `${matchedAnimalMaster.name} (${matchedAnimalMaster.base_weight} ${matchedAnimalMaster.base_unit})`, color: 'var(--color-primary)' }] : []),
                                ].map((info, i) => (
                                    <div key={i} style={{
                                        background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 12,
                                    }}>
                                        <div style={{ color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                            {info.icon} {info.label}
                                        </div>
                                        <div style={{ fontWeight: 700, color: info.color || 'var(--color-text-primary)', marginTop: 4, fontSize: 13 }}>
                                            {info.value}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Section 2: Amount to Butcher */}
                    <div className="butcher-panel" style={{ marginTop: 20 }}>
                        <h3 className="butcher-panel-title">2. Amount to Butcher</h3>
                        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div className="form-field" style={{ maxWidth: 200 }}>
                                <label>How much to butcher (kg) *</label>
                                <input
                                    className="form-input"
                                    type="number"
                                    step="0.1"
                                    min="0.1"
                                    max={parentWeight}
                                    value={amountToButcher}
                                    onChange={e => handleAmountChange(e.target.value)}
                                    style={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }}
                                />
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', paddingBottom: 10 }}>
                                out of <strong style={{ color: 'var(--color-success)' }}>{parentWeight} kg</strong> available
                                {butcherAmt > parentWeight && (
                                    <span style={{ color: '#ef4444', marginLeft: 8 }}>⚠️ Exceeds available!</span>
                                )}
                            </div>
                            {matchedAnimalMaster && (
                                <div style={{
                                    fontSize: 12, color: 'var(--color-primary)', background: 'var(--color-primary-muted)',
                                    padding: '8px 14px', borderRadius: 'var(--radius-md)', marginBottom: 6,
                                }}>
                                    📐 Cut weights auto-calculated from <strong>{matchedAnimalMaster.name}</strong> template
                                    ({matchedAnimalMaster.base_weight} {matchedAnimalMaster.base_unit} base → {matchedAnimalMaster.cut_types?.length || 0} cuts)
                                </div>
                            )}
                        </div>
                        {(matchedAnimalMaster?.allowed_butchering_quantities || []).length > 0 && (
                            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>Suggested quantities:</span>
                                {matchedAnimalMaster.allowed_butchering_quantities.filter(q => Number(q) <= parentWeight).map(q => (
                                    <button key={q} type="button" className="btn btn-secondary btn-sm" onClick={() => handleAmountChange(String(q))}>{q} kg</button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Section 3: Cut Output Rows */}
                    <div className="butcher-panel" style={{ marginTop: 20 }}>
                        <div className="butcher-panel-header">
                            <h3 className="butcher-panel-title">3. Cut Output — {cuts.length} rows</h3>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                                    <input type="checkbox" checked={showAllCuts} onChange={e => setShowAllCuts(e.target.checked)} />
                                    Show all cut types
                                </label>
                                <button className="btn btn-secondary btn-sm" onClick={addRow}><MdAdd /> Add Cut</button>
                            </div>
                        </div>

                        <div className="butcher-table-wrap">
                            <table className="butcher-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '28%' }}>CUT TYPE</th>
                                        <th style={{ width: '14%' }}>WEIGHT (kg)</th>
                                        <th style={{ width: '10%' }}>SHELF LIFE</th>
                                        <th style={{ width: '10%' }}>TYPE</th>
                                        <th style={{ width: '22%' }}>CHILD BATCH #</th>
                                        <th style={{ width: 40 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cuts.map(cut => (
                                        <tr key={cut.id} className={cut.is_waste ? 'waste-row' : ''}>
                                            <td>
                                                <select className="table-cell-select" style={{ width: '100%' }}
                                                    value={cut.cut_name}
                                                    onChange={e => updateRow(cut.id, 'cut_name', e.target.value)}>
                                                    {getAvailableCutTypes().map(c => (
                                                        <option key={c.name} value={c.name}>
                                                            {c.name} {c.is_waste ? '(Waste)' : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td>
                                                <input type="number" className="table-cell-input" style={{ width: '100%' }}
                                                    step="0.1" min="0" value={cut.weight_kg}
                                                    onChange={e => updateRow(cut.id, 'weight_kg', e.target.value)} />
                                            </td>
                                            <td>
                                                <input type="number" className="table-cell-input" style={{ width: '100%' }}
                                                    min="1" value={cut.shelf_life_days}
                                                    onChange={e => updateRow(cut.id, 'shelf_life_days', e.target.value)} />
                                            </td>
                                            <td>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                                                    <input type="checkbox" checked={cut.is_waste}
                                                        onChange={e => updateRow(cut.id, 'is_waste', e.target.checked)} />
                                                    {cut.is_waste ? <span className="chip-red">Waste</span> : <span className="chip-green">Usable</span>}
                                                </label>
                                            </td>
                                            <td>
                                                <input type="text" className="table-cell-input" style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}
                                                    value={cut.child_batch_no}
                                                    onChange={e => updateRow(cut.id, 'child_batch_no', e.target.value)} />
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <button className="btn-icon-danger" onClick={() => removeRow(cut.id)}>
                                                    <MdDelete size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Yield Dashboard */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginTop: 20 }}>
                            {[
                                { label: 'To Butcher', value: `${butcherAmt} kg`, color: 'var(--color-text-primary)' },
                                { label: 'Usable Cuts', value: `${usableWeight.toFixed(1)} kg`, color: '#22c55e' },
                                { label: 'Waste', value: `${wasteWeight.toFixed(1)} kg`, color: '#ef4444' },
                                { label: 'Allocated', value: `${allocated.toFixed(1)} kg`, color: isOverAllocated ? '#ef4444' : 'var(--color-primary)' },
                                { label: 'Remaining', value: `${remaining.toFixed(1)} kg`, color: remaining > 0 ? '#f59e0b' : '#22c55e' },
                                { label: 'Yield', value: `${yieldPct}%`, color: yieldPct >= 80 ? '#22c55e' : yieldPct >= 60 ? '#f59e0b' : '#ef4444' },
                            ].map((m, i) => (
                                <div key={i} style={{
                                    background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-md)', padding: '10px 14px', textAlign: 'center',
                                }}>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{m.label}</div>
                                    <div style={{ fontSize: 18, fontWeight: 700, color: m.color }}>{m.value}</div>
                                </div>
                            ))}
                        </div>

                        {isOverAllocated && (
                            <div style={{ marginTop: 12, padding: '10px 16px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', color: '#ef4444', fontSize: 13, border: '1px solid rgba(239,68,68,0.3)' }}>
                                <MdWarning style={{ verticalAlign: 'middle', marginRight: 6 }} />
                                Over-allocated by <strong>{(allocated - butcherAmt).toFixed(1)} kg</strong>. Reduce cut weights before saving.
                            </div>
                        )}

                        {/* Notes & Submit */}
                        <div style={{ marginTop: 20 }}>
                            <div className="form-field" style={{ maxWidth: 500 }}>
                                <label>Notes</label>
                                <textarea className="form-textarea" rows={2} value={notes}
                                    onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                            <button className="btn btn-secondary btn-md" onClick={() => navigate('/butchering/dashboard')}>Cancel</button>
                            <button className="btn btn-primary btn-md" onClick={handleSave} disabled={saving || isOverAllocated}>
                                <MdSave /> {saving ? 'Creating Order...' : 'Create Butchering Order'}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default NewButcheringOrder;
