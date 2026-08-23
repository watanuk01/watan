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
    getUnbutcheredBatches,
    getCutTypes,
    createButcheringOrder,
} from '../../services/butcheringService';
import QrCodeSvg from '../../components/ui/QrCodeSvg';
import toast from 'react-hot-toast';
import './ButcheringModule.css';

const safeNum = (v, fallback = 0) => { const n = Number(v); return isNaN(n) ? fallback : n; };

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

let _rowCounter = 1;
const newRowId = () => String(_rowCounter++);

// Build readable genealogy text for QR codes — no URLs, just full traceability as text
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
    //setBatches stores parent batches returned by:getUnbutcheredBatches()
    const [batches, setBatches] = useState([]);
    //setCutMaster stores master records returned by:getCutTypes()
    const [cutMaster, setCutMaster] = useState([]);
    //Stores only the selected batch's Firestore document ID.
    const [selectedBatchId, setSelectedBatchId] = useState('');
    //Stores the complete selected parent batch object.
    const [selectedBatch, setSelectedBatch] = useState(null);
    const [butcherName, setButcherName] = useState('Central Kitchen Butcher');
    const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
    const [notes, setNotes] = useState('');
    //This stores the cut output rows.
    const [cuts, setCuts] = useState([]);
    //stores the result returned by the service createButcheringOrder.
    const [createdOrder, setCreatedOrder] = useState(null);

    const load = async () => {
        setLoading(true);
        try {
            //both should called successfully else get rejected and go into catch error block
            const [batchList, cutList] = await Promise.all([getUnbutcheredBatches(), getCutTypes()]);

            //The purpose is to convert Firestore timestamp objects into display-safe date strings.
            const sanitizedBatches = (batchList || []).map(sanitize);
            const sanitizedCuts = (cutList || []).map(sanitize);

            setBatches(sanitizedBatches);

            setCutMaster(sanitizedCuts);

            let initialBatch = sanitizedBatches[0] || null;
            if (preselectedId) {
                initialBatch = sanitizedBatches.find(b => b.id === preselectedId) || initialBatch;
            }

            if (initialBatch) {
                // sets the selected value in the dropdown.
                setSelectedBatchId(initialBatch.id);
                //provides full source-batch data weight calculations,vendor display,expiry display,service submission.
                setSelectedBatch(initialBatch);
                //creates initial output rows based on the selected animal.
                applyDefaultCuts(initialBatch, sanitizedCuts);
            }
        } catch (err) {
            console.error('Load error:', err);
            toast.error('Failed to load batch data');
        } finally {
            setLoading(false);
        }
    };

    const [showAllCuts, setShowAllCuts] = useState(false);

    // Detect Animal Type from batch item name — supports all species including seafood
    const detectAnimalType = (batch) => {
        if (!batch) return null;
        if (batch.animal_type) return batch.animal_type;
        const name = (batch.item_name || '').toLowerCase();
        if (name.includes('chicken')) return 'Chicken';
        if (name.includes('beef') || name.includes('cow') || name.includes('veal')) return 'Beef';
        if (name.includes('mutton')) return 'Mutton';
        if (name.includes('goat')) return 'Goat';
        if (name.includes('lamb') || name.includes('sheep')) return 'Lamb';
        if (name.includes('pork') || name.includes('pig')) return 'Pork';
        if (name.includes('turkey')) return 'Turkey';
        if (name.includes('duck')) return 'Duck';
        // Seafood detection — prawns, shrimp, fish, salmon, cod, squid, lobster, crab, etc.
        if (name.includes('prawn') || name.includes('shrimp') || name.includes('fish') ||
            name.includes('salmon') || name.includes('cod') || name.includes('squid') ||
            name.includes('lobster') || name.includes('crab') || name.includes('oyster') ||
            name.includes('scallop') || name.includes('octopus') || name.includes('tuna') ||
            name.includes('haddock') || name.includes('mackerel') || name.includes('seafood')) return 'Seafood';
        // Unknown product — return null so we show ALL cut types
        return null;
    };

    // Creates default cut rows based on selected batch animal type
    const applyDefaultCuts = (batch, masterList) => {
        const animalType = detectAnimalType(batch);
        const parentNo = batch.batch_number || batch.id;
        const parentWeight = safeNum(batch.weight_kg || batch.quantity || batch.initial_quantity, 10);

        // Filter master list to cuts matching this animal type (or Mutton/Lamb grouped)
        const filtered = animalType ? masterList.filter(c => {
            const cutAnimal = (c.animal_type || '').toLowerCase();
            const targetAnimal = animalType.toLowerCase();
            if (targetAnimal === 'mutton' || targetAnimal === 'lamb') {
                return cutAnimal === 'mutton' || cutAnimal === 'lamb';
            }
            return cutAnimal === targetAnimal;
        }) : [];

        const listToUse = filtered.length > 0 ? filtered : masterList;
        const defaults = listToUse.slice(0, 5).map((c, i) => {
            const code = c.name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
            // Proportional initial weight allocation so total defaults don't exceed carcass weight
            const stdW = safeNum(c.std_weight_kg, 2.5);
            const propWeight = Math.min(stdW, Math.round((parentWeight / (listToUse.length || 4)) * 10) / 10);
            return {
                id: newRowId(),
                cut_name: c.name,
                weight_kg: propWeight > 0 ? propWeight : 1.0,
                is_waste: Boolean(c.is_waste),
                shelf_life_days: safeNum(c.shelf_life_days, 5),
                child_batch_no: `${parentNo}-${code}-${i + 1}`,
            };
        });
        setCuts(defaults);
    };

    useEffect(() => { load(); }, []);

    // Runs when user selects another option in source batch dropdown
    const handleBatchChange = (id) => {
        setSelectedBatchId(id);
        const found = batches.find(b => b.id === id);
        setSelectedBatch(found || null);
        if (found) applyDefaultCuts(found, cutMaster);
    };

    // Current detected animal type for selected batch
    const currentAnimal = detectAnimalType(selectedBatch);

    // Filter available cuts for table dropdown — falls back to ALL cuts if no match
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
        // If no matching cuts found for this animal, show all cuts
        return filtered.length > 0 ? filtered : cutMaster;
    };

    // Parent weight and allocation metrics
    const parentWeight = safeNum(selectedBatch?.weight_kg || selectedBatch?.quantity || selectedBatch?.initial_quantity, 0);
    const usableWeight = cuts.filter(c => !c.is_waste).reduce((s, c) => s + safeNum(c.weight_kg), 0);
    const wasteWeight = cuts.filter(c => c.is_waste).reduce((s, c) => s + safeNum(c.weight_kg), 0);
    const allocated = usableWeight + wasteWeight;
    const remaining = Math.max(0, parentWeight - allocated);

    // Yield Rate: (Usable Cuts Weight / Parent Weight) * 100
    const yieldPct = parentWeight > 0 ? Math.round((usableWeight / parentWeight) * 1000) / 10 : 0;
    const isOverAllocated = allocated > parentWeight + 0.05;
    const isYieldInvalid = usableWeight > parentWeight;

    const addRow = () => {
        const available = getAvailableCutTypes();
        const defaultCut = available[0] || cutMaster[0];
        const parentNo = selectedBatch?.batch_number || 'BAT';
        const code = (defaultCut?.name || 'CUT').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();

        // Smart weight for newly added row (uses remaining unallocated weight up to 2.5 kg)
        const unallocatedLeft = Math.max(0, parentWeight - allocated);
        const initialWeight = unallocatedLeft > 0 ? Math.min(2.5, Math.round(unallocatedLeft * 10) / 10) : 1.0;

        setCuts(p => [...p, {
            id: newRowId(),
            cut_name: defaultCut?.name || 'Lamb Chops',
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
                    updated.weight_kg = safeNum(master.std_weight_kg, c.weight_kg);
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
            toast.error(`Cannot save: Total allocated (${allocated.toFixed(1)} kg) exceeds source weight (${parentWeight} kg) by ${(allocated - parentWeight).toFixed(1)} kg!`);
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

    return (
        <div className="butcher-page">
            {/* Header */}
            <div className="butcher-page-header">
                <div>
                    <button className="btn-back" onClick={() => navigate('/butchering/dashboard')}>
                        <MdArrowBack /> Back to Dashboard
                    </button>
                    <h1 className="butcher-page-title" style={{ marginTop: 6 }}>
                        <MdContentCut className="title-icon" /> New Butchering Order
                    </h1>
                    <p className="butcher-page-subtitle">
                        Split a whole meat parent batch into child cut batches with QR tracking &amp; yield measurement
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="butcher-loading">Loading raw meat batches and cut types...</div>
            ) : batches.length === 0 ? (
                <div className="butcher-panel" style={{ textAlign: 'center', padding: '40px 20px' }}>
                    <MdWarning size={48} color="var(--color-warning)" style={{ marginBottom: 12 }} />
                    <h3 style={{ color: 'var(--color-text-primary)' }}>No Parent Meat Batches Available</h3>
                    <p style={{ color: 'var(--color-text-muted)', marginBottom: 20 }}>
                        There are no whole animal or raw meat batches awaiting processing in inventory.
                    </p>
                    <button className="btn btn-primary btn-md" onClick={() => navigate('/butchering/purchase-order')}>
                        Create Meat Purchase Order
                    </button>
                </div>
            ) : (
                <>
                    {/* Section 1: Source Batch & Info */}
                    <div className="butcher-panel">
                        <h3 className="butcher-panel-title">1. Select Source Batch &amp; Butcher Details</h3>
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
                                <label>Butcher Name *</label>
                                <input className="form-input" type="text" value={butcherName} onChange={e => setButcherName(e.target.value)} placeholder="Enter butcher name" />
                            </div>
                            <div className="form-field">
                                <label>Processing Date *</label>
                                <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                            </div>
                        </div>

                        {selectedBatch && (
                            <div className="source-batch-card">
                                <div className="source-batch-card-header">
                                    <div className="source-batch-title-group">
                                        <span className="source-animal-badge">{currentAnimal === 'Seafood' ? '🦐' : '🥩'} {currentAnimal || 'Mixed / Other'}</span>
                                        <span className="batch-code-badge">{selectedBatch.batch_number || selectedBatch.id}</span>
                                    </div>
                                    <div className="source-batch-status-chip">
                                        <span className="chip-green">Raw Parent Carcass</span>
                                    </div>
                                </div>

                                <div className="source-batch-card-grid">
                                    <div className="source-grid-item">
                                        <div className="source-grid-label"><MdInventory2 className="icon" /> Product Name</div>
                                        <div className="source-grid-value main-product-name">{selectedBatch.item_name}</div>
                                    </div>

                                    <div className="source-grid-item">
                                        <div className="source-grid-label"><MdScale className="icon" /> Total Input Weight</div>
                                        <div className="source-grid-value weight-value">{parentWeight} <span className="unit">kg</span></div>
                                    </div>

                                    <div className="source-grid-item">
                                        <div className="source-grid-label"><MdStore className="icon" /> Vendor / Supplier</div>
                                        <div className="source-grid-value">{selectedBatch.vendor_name || selectedBatch.supplier || 'Al-Safa Meats'}</div>
                                    </div>

                                    <div className="source-grid-item">
                                        <div className="source-grid-label"><MdCalendarToday className="icon" /> Expiry Date</div>
                                        <div className="source-grid-value expiry-value">{selectedBatch.expiry_date || '—'}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Section 2: Cut Output Rows */}
                    <div className="butcher-panel">
                        <div className="butcher-panel-header">
                            <div>
                                <h3 className="butcher-panel-title">2. Define Cut Types &amp; Output Weights</h3>
                                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                    Showing cut types for <strong>{currentAnimal || 'All Types'}</strong> &nbsp;
                                    <button
                                        className="btn-text-link"
                                        style={{ fontSize: 11, cursor: 'pointer' }}
                                        onClick={() => setShowAllCuts(v => !v)}
                                    >
                                        {showAllCuts ? '(Show Filtered Only)' : '(Show All Animals)'}
                                    </button>
                                </p>
                            </div>
                            <button className="btn btn-secondary btn-sm" onClick={addRow}>
                                <MdAdd /> Add Row
                            </button>
                        </div>

                        {/* Over-allocation warning banner */}
                        {isOverAllocated ? (
                            <div className="weight-warning-banner red">
                                <MdWarning size={20} />
                                <span>
                                    <strong>Over-Allocated Weight Error:</strong> Total cuts ({allocated.toFixed(1)} kg) exceed the source carcass weight ({parentWeight} kg) by <strong>{(allocated - parentWeight).toFixed(1)} kg</strong>! Adjust cut weights to continue.
                                </span>
                            </div>
                        ) : remaining > 0 ? (
                            <div className="weight-warning-banner amber">
                                <MdInfo size={18} />
                                <span>
                                    <strong>Unallocated Carcass Weight:</strong> {remaining.toFixed(1)} kg remaining out of {parentWeight} kg.
                                </span>
                            </div>
                        ) : null}

                        <div className="butcher-table-wrap">
                            <table className="butcher-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '32%' }}>Cut Type</th>
                                        <th style={{ width: '15%' }}>Weight (kg)</th>
                                        <th style={{ width: '15%' }}>Is Waste?</th>
                                        <th style={{ width: '30%' }}>Child Batch No</th>
                                        <th style={{ width: '8%' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cuts.map(row => (
                                        <tr key={row.id} className={row.is_waste ? 'waste-row' : ''}>
                                            <td>
                                                <select className="table-cell-select" value={row.cut_name} onChange={e => updateRow(row.id, 'cut_name', e.target.value)}>
                                                    {getAvailableCutTypes().map(c => (
                                                        <option key={c.id} value={c.name}>
                                                            {c.name} ({c.animal_type}){c.is_waste ? ' [Waste]' : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td>
                                                <input
                                                    type="number" step="0.1" min="0"
                                                    className="table-cell-input"
                                                    value={row.weight_kg}
                                                    onChange={e => updateRow(row.id, 'weight_kg', Number(e.target.value))}
                                                />
                                            </td>
                                            <td>
                                                <label className="checkbox-row">
                                                    <input type="checkbox" checked={row.is_waste} onChange={e => updateRow(row.id, 'is_waste', e.target.checked)} />
                                                    {row.is_waste ? <span className="chip-red">Waste</span> : <span className="chip-green">Usable</span>}
                                                </label>
                                            </td>
                                            <td><span className="batch-code" style={{ fontSize: 11 }}>{row.child_batch_no}</span></td>
                                            <td>
                                                <button className="btn-icon-danger" onClick={() => removeRow(row.id)} title="Remove row">
                                                    <MdDelete size={15} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Weight Progress Bar */}
                        <div className="weight-progress-section">
                            <div className="weight-progress-row">
                                <span>Weight Allocation</span>
                                <strong style={{ color: isOverAllocated ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                                    {allocated.toFixed(1)} kg / {parentWeight} kg
                                </strong>
                            </div>
                            <div className="weight-progress-track">
                                <div className="weight-fill-usable" style={{ width: `${Math.min(100, (usableWeight / parentWeight) * 100)}%` }} />
                                <div className="weight-fill-waste" style={{ width: `${Math.min(100, (wasteWeight / parentWeight) * 100)}%` }} />
                            </div>
                            <div className="weight-legend">
                                <span><span className="legend-dot" style={{ background: 'var(--color-success)' }} />Usable Cuts ({usableWeight.toFixed(1)} kg)</span>
                                <span><span className="legend-dot" style={{ background: 'var(--color-danger)' }} />Waste/Bones ({wasteWeight.toFixed(1)} kg)</span>
                                <span><span className="legend-dot" style={{ background: 'var(--color-border-strong)' }} />Unallocated ({remaining.toFixed(1)} kg)</span>
                            </div>
                        </div>
                    </div>

                    {/* Section 3: Yield Summary + QR Previews */}
                    <div className="butcher-col-2">
                        {/* Yield Summary */}
                        <div className="butcher-panel">
                            <h3 className="butcher-panel-title"><MdTrendingUp /> Yield Summary</h3>
                            <div className="yield-cards-row">
                                <div className="yield-card">
                                    <div className="yield-card-label">Source Weight</div>
                                    <div className="yield-card-value">{parentWeight} kg</div>
                                </div>
                                <div className="yield-card">
                                    <div className="yield-card-label">Usable Output</div>
                                    <div className="yield-card-value" style={{ color: isYieldInvalid ? 'var(--color-danger)' : 'var(--color-success)' }}>
                                        {usableWeight.toFixed(1)} kg
                                    </div>
                                </div>
                                <div className="yield-card">
                                    <div className="yield-card-label">Waste &amp; Bones</div>
                                    <div className="yield-card-value" style={{ color: 'var(--color-danger)' }}>{wasteWeight.toFixed(1)} kg</div>
                                </div>
                                <div className="yield-card highlight">
                                    <div className="yield-card-label">Yield Rate</div>
                                    <div className="yield-card-value" style={{ color: isYieldInvalid ? 'var(--color-danger)' : yieldPct >= 90 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                                        {isYieldInvalid ? 'INVALID (>100%)' : `${yieldPct}%`}
                                    </div>
                                </div>
                            </div>
                            <div style={{ marginTop: 16 }}>
                                <div className="form-field">
                                    <label>Butchering Notes</label>
                                    <textarea className="form-textarea" rows="2" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Quality notes, yield observations..." />
                                </div>
                            </div>
                        </div>

                        {/* QR Previews */}
                        <div className="butcher-panel">
                            <h3 className="butcher-panel-title"><MdQrCodeScanner /> Child Batch QR Previews</h3>
                            <div className="qr-preview-list">
                                {cuts.map((c, i) => (
                                    <div key={i} className="qr-preview-item">
                                        <QrCodeSvg value={buildBatchQrText({
                                            batchNo: c.child_batch_no,
                                            cutName: c.cut_name,
                                            weightKg: c.weight_kg,
                                            isWaste: c.is_waste,
                                            parentBatchNo: selectedBatch?.batch_number || selectedBatch?.id || '—',
                                            parentProduct: selectedBatch?.item_name || '—',
                                            parentWeight: parentWeight,
                                            vendor: selectedBatch?.vendor_name || selectedBatch?.supplier || 'Meat Supplier',
                                            butcherName: butcherName,
                                            date: date,
                                            yieldPct: yieldPct,
                                            expiry: '—',
                                            orderNo: null,
                                        })} size={70} color="#C9A96E" bg="#1A1D2E" />
                                        <div>
                                            <div className="qr-item-name">{c.cut_name}</div>
                                            <div className="qr-item-batch">{c.child_batch_no}</div>
                                            <div className="qr-item-weight">
                                                {c.weight_kg} kg &nbsp;•&nbsp;
                                                {c.is_waste ? <span className="chip-red">Waste</span> : <span className="chip-green">Usable</span>}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Submit */}
                    <div className="action-footer">
                        <button className="btn btn-secondary btn-md" onClick={() => navigate('/butchering/dashboard')}>Cancel</button>
                        <button className="btn btn-primary btn-md" onClick={handleSave} disabled={saving || isOverAllocated || usableWeight <= 0}>
                            <MdSave /> {saving ? 'Creating Batches...' : isOverAllocated ? 'Over-Allocated (Fix Weights)' : 'Save Order & Generate Child Batches'}
                        </button>
                    </div>
                </>
            )}

            {/* Success Modal with QR Labels */}
            {createdOrder && (
                <div className="butcher-modal-overlay">
                    <div className="butcher-modal">
                        <div className="modal-head">
                            <h2><MdCheckCircle color="var(--color-success)" style={{ fontSize: 22 }} /> Order Created: {createdOrder.order_no}</h2>
                            <button className="modal-close" onClick={() => setCreatedOrder(null)}>×</button>
                        </div>
                        <div className="modal-body-scroll">
                            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 20 }}>
                                Batch <strong style={{ color: 'var(--color-primary)' }}>{createdOrder.source_batch_no}</strong> has been split into{' '}
                                <strong>{createdOrder.child_batches?.length || 0}</strong> child batches with{' '}
                                <strong style={{ color: 'var(--color-success)' }}>{createdOrder.yield_pct}% yield</strong>.
                            </p>
                            <h4 style={{ color: 'var(--color-text-secondary)', marginBottom: 12, fontSize: 13 }}>PHYSICAL QR LABELS</h4>
                            <div className="qr-print-grid">
                                {createdOrder.child_batches?.map((cb, idx) => (
                                    <div key={idx} className="qr-label-box">
                                        <div className="qr-label-header">WATAN CENTRAL KITCHEN</div>
                                        <div className="qr-label-body">
                                            <QrCodeSvg value={cb.qr_code_data || buildBatchQrText({
                                                batchNo: cb.batch_number,
                                                cutName: cb.cut_name || cb.item_name,
                                                weightKg: cb.quantity,
                                                isWaste: cb.is_waste,
                                                parentBatchNo: cb.parent_batch_no || createdOrder.source_batch_no,
                                                parentProduct: createdOrder.source_product,
                                                parentWeight: createdOrder.input_weight_kg,
                                                vendor: cb.vendor_name || 'Meat Supplier',
                                                butcherName: createdOrder.butcher_name,
                                                date: createdOrder.date,
                                                yieldPct: createdOrder.yield_pct,
                                                expiry: cb.expiry_date,
                                                orderNo: createdOrder.order_no,
                                            })} size={80} />
                                            <div className="qr-label-info">
                                                <div className="qr-label-product">{cb.item_name}</div>
                                                <div>Batch: <strong>{cb.batch_number}</strong></div>
                                                <div>Weight: <strong>{cb.quantity} kg</strong></div>
                                                <div>Expiry: <strong>{cb.expiry_date}</strong></div>
                                                <div>Parent: {cb.parent_batch_no}</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="modal-foot">
                            <button className="btn btn-secondary btn-md" onClick={() => window.print()}><MdPrint /> Print Labels</button>
                            <button className="btn btn-primary btn-md" onClick={() => navigate('/traceability')}>View Traceability Tree</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NewButcheringOrder;
