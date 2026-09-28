import React, { useState, useEffect, useMemo } from 'react';
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
    MdSyncAlt,
    MdSearch,
    MdClose,
    MdFilterList,
} from 'react-icons/md';
import {
    getButcherInventory,
    getCutTypes,
    getAnimals,
    createButcheringOrder,
    saveCutCKMapping,
    getCutCKMappings,
    formatKg,
} from '../../services/butcheringService';
import { getItems } from '../../services/inventoryService';
import MapCutToCKModal from './MapCutToCKModal';
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

const NewButcheringOrder = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const preselectedId = searchParams.get('source');

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [batches, setBatches] = useState([]);
    const [cutMaster, setCutMaster] = useState([]);
    const [animals, setAnimals] = useState([]);
    const [ckItems, setCkItems] = useState([]);
    const [selectedBatchId, setSelectedBatchId] = useState('');
    const [selectedBatch, setSelectedBatch] = useState(null);
    const [butcherName, setButcherName] = useState('Central Kitchen Butcher');
    const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
    const [notes, setNotes] = useState('');
    const [cuts, setCuts] = useState([]);
    const [createdOrder, setCreatedOrder] = useState(null);
    const [amountToButcher, setAmountToButcher] = useState('');
    const [showAllCuts, setShowAllCuts] = useState(false);
    const [mappingBatch, setMappingBatch] = useState(null);
    const [savedCKMappings, setSavedCKMappings] = useState({});
    const [batchCategoryFilter, setBatchCategoryFilter] = useState('ALL');
    const [batchSearchTerm, setBatchSearchTerm] = useState('');
    const [ckCategoryFilter, setCkCategoryFilter] = useState('ALL');

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

    const getCategoryForBatch = (batch) => {
        const animal = detectAnimalType(batch);
        if (animal) return animal;
        const cat = (batch?.category || '').toLowerCase();
        if (cat.includes('chicken')) return 'Chicken';
        if (cat.includes('beef')) return 'Beef';
        if (cat.includes('lamb')) return 'Lamb';
        if (cat.includes('mutton')) return 'Mutton';
        if (cat.includes('goat')) return 'Goat';
        return 'Other';
    };

    // Category counts for quick filter pills
    const batchCategories = useMemo(() => {
        const counts = { ALL: batches.length };
        batches.forEach(b => {
            const cat = getCategoryForBatch(b);
            counts[cat] = (counts[cat] || 0) + 1;
        });
        return counts;
    }, [batches]);

    // Batches filtered by category and search term
    const filteredBatches = useMemo(() => {
        return batches.filter(b => {
            if (batchCategoryFilter !== 'ALL') {
                const cat = getCategoryForBatch(b);
                if (cat !== batchCategoryFilter) return false;
            }
            if (batchSearchTerm.trim()) {
                const q = batchSearchTerm.toLowerCase().trim();
                const bNo = (b.batch_number || b.id || '').toLowerCase();
                const iName = (b.item_name || '').toLowerCase();
                const vName = (b.vendor_name || b.supplier || '').toLowerCase();
                const aType = (detectAnimalType(b) || '').toLowerCase();
                return bNo.includes(q) || iName.includes(q) || vName.includes(q) || aType.includes(q);
            }
            return true;
        });
    }, [batches, batchCategoryFilter, batchSearchTerm]);

    const handleCategoryFilterChange = (cat) => {
        setBatchCategoryFilter(cat);
        const newFiltered = batches.filter(b => {
            if (cat !== 'ALL' && getCategoryForBatch(b) !== cat) return false;
            if (batchSearchTerm.trim()) {
                const q = batchSearchTerm.toLowerCase().trim();
                const bNo = (b.batch_number || b.id || '').toLowerCase();
                const iName = (b.item_name || '').toLowerCase();
                const vName = (b.vendor_name || b.supplier || '').toLowerCase();
                const aType = (detectAnimalType(b) || '').toLowerCase();
                return bNo.includes(q) || iName.includes(q) || vName.includes(q) || aType.includes(q);
            }
            return true;
        });
        if (newFiltered.length > 0 && !newFiltered.some(b => b.id === selectedBatchId)) {
            handleBatchChange(newFiltered[0].id);
        }
    };

    const handleBatchSearchChange = (val) => {
        setBatchSearchTerm(val);
        const q = val.toLowerCase().trim();
        if (q) {
            const matches = batches.filter(b => {
                if (batchCategoryFilter !== 'ALL' && getCategoryForBatch(b) !== batchCategoryFilter) return false;
                const bNo = (b.batch_number || b.id || '').toLowerCase();
                const iName = (b.item_name || '').toLowerCase();
                const vName = (b.vendor_name || b.supplier || '').toLowerCase();
                const aType = (detectAnimalType(b) || '').toLowerCase();
                return bNo.includes(q) || iName.includes(q) || vName.includes(q) || aType.includes(q);
            });
            if (matches.length > 0 && !matches.some(b => b.id === selectedBatchId)) {
                handleBatchChange(matches[0].id);
            }
        }
    };

    // Helper to test if a CK item matches an active category filter
    const itemMatchesCkCategory = (item, catId) => {
        if (!item || !catId || catId === 'ALL') return true;
        if (catId === 'RAW_MEAT') return item.item_type === 'raw_meat';
        if (catId === 'COOKED_MEAT') return item.item_type === 'cooked_meat';
        const text = `${item.name || ''} ${item.category_name || ''} ${item.sku || ''}`.toLowerCase();
        if (catId === 'Lamb') return text.includes('lamb') || text.includes('sheep');
        if (catId === 'Chicken') return text.includes('chicken') || text.includes('poultry');
        if (catId === 'Beef') return text.includes('beef') || text.includes('cow') || text.includes('steak');
        if (catId === 'Mutton') return text.includes('mutton');
        if (catId === 'Goat') return text.includes('goat');
        if (catId === 'Seafood') return /fish|prawn|salmon|cod|seafood/.test(text);
        if (catId === 'OTHER') {
            return !/lamb|sheep|mutton|chicken|poultry|beef|cow|steak|goat|fish|prawn|salmon|cod|seafood/.test(text);
        }
        if (catId.startsWith('CAT_')) {
            const catName = catId.replace('CAT_', '');
            return (item.category_name || '') === catName;
        }
        return (item.category_name || '') === catId;
    };

    // Dynamic category list with item counts for CK destination items
    const ckCategories = useMemo(() => {
        const list = [
            { id: 'ALL', label: 'All CK Items', icon: '📦', count: ckItems.length },
            { id: 'RAW_MEAT', label: 'Raw Meat', icon: '🥩', count: ckItems.filter(i => i.item_type === 'raw_meat').length },
            { id: 'COOKED_MEAT', label: 'Cooked Meat', icon: '🍛', count: ckItems.filter(i => i.item_type === 'cooked_meat').length },
            { id: 'Lamb', label: 'Lamb', icon: '🐑', count: ckItems.filter(i => `${i.name || ''} ${i.category_name || ''}`.toLowerCase().includes('lamb')).length },
            { id: 'Chicken', label: 'Chicken', icon: '🐔', count: ckItems.filter(i => /chicken|poultry/.test(`${i.name || ''} ${i.category_name || ''}`.toLowerCase())).length },
            { id: 'Beef', label: 'Beef', icon: '🐄', count: ckItems.filter(i => /beef|steak|cow/.test(`${i.name || ''} ${i.category_name || ''}`.toLowerCase())).length },
            { id: 'Mutton', label: 'Mutton', icon: '🐐', count: ckItems.filter(i => `${i.name || ''} ${i.category_name || ''}`.toLowerCase().includes('mutton')).length },
            { id: 'Goat', label: 'Goat', icon: '🐐', count: ckItems.filter(i => `${i.name || ''} ${i.category_name || ''}`.toLowerCase().includes('goat')).length },
            { id: 'Seafood', label: 'Seafood', icon: '🐟', count: ckItems.filter(i => /fish|prawn|salmon|cod|seafood/.test(`${i.name || ''} ${i.category_name || ''}`.toLowerCase())).length },
        ];

        // Collect custom category names present in ckItems
        const knownWords = new Set(['lamb', 'mutton', 'chicken', 'poultry', 'beef', 'steak', 'cow', 'goat', 'seafood', 'fish', 'raw meat', 'cooked meat']);
        const customCats = new Map();
        ckItems.forEach(i => {
            const cat = (i.category_name || '').trim();
            if (cat && !knownWords.has(cat.toLowerCase())) {
                customCats.set(cat, (customCats.get(cat) || 0) + 1);
            }
        });

        customCats.forEach((count, catName) => {
            list.push({
                id: `CAT_${catName}`,
                label: catName,
                icon: '🏷️',
                count,
            });
        });

        return list.filter(c => c.count > 0 || c.id === 'ALL');
    }, [ckItems]);

    // Find matching animal master for proportional calculations
    const findMatchingAnimal = (batch, animalsList = animals) => {
        if (!batch || !animalsList?.length) return null;
        const batchName = (batch.item_name || '').toLowerCase();
        // First try exact name match
        let match = animalsList.find(a => batchName.includes((a.name || '').toLowerCase()) || (a.name || '').toLowerCase().includes(batchName));
        if (match) return match;
        // Then try animal_type match
        const animalType = detectAnimalType(batch);
        if (animalType) {
            match = animalsList.find(a => (a.animal_type || '').toLowerCase() === animalType.toLowerCase());
        }
        return match || null;
    };

    // Auto-match CK inventory item for a cut name
    const findAutoCKItem = (cutName, itemsList = ckItems) => {
        if (!cutName || !itemsList?.length) return null;
        const cLower = cutName.toLowerCase().trim();
        // Priority 1: exact name match
        const exact = itemsList.find(i => (i.name || '').toLowerCase().trim() === cLower);
        if (exact) return exact;
        // Priority 2: raw_meat substring match
        return itemsList.find(i => 
            i.item_type === 'raw_meat' && 
            (cLower.includes((i.name || '').toLowerCase().trim()) || (i.name || '').toLowerCase().trim().includes(cLower))
        ) || itemsList.find(i => 
            (cLower.includes((i.name || '').toLowerCase().trim()) || (i.name || '').toLowerCase().trim().includes(cLower))
        ) || null;
    };

    // Helper to resolve the default CK mapping with multi-tiered fallback
    const resolveCutMapping = (cutName, cutTypeObj, cutsMasterList = cutMaster, loadedCkItems = ckItems, mappings = savedCKMappings) => {
        if (!cutName) return { id: '', name: '' };
        const cLower = cutName.toLowerCase().trim();

        // 1. Explicit default on the cut_type object (from animal master)
        if (cutTypeObj?.default_ck_item_id) {
            return {
                id: cutTypeObj.default_ck_item_id,
                name: cutTypeObj.default_ck_item_name || '',
            };
        }

        // 2. Direct match in persistent mappings (from Firestore cut_ck_mappings or scanned)
        if (mappings && mappings[cLower]?.item_id) {
            return {
                id: mappings[cLower].item_id,
                name: mappings[cLower].item_name || '',
            };
        }

        // 2b. Fuzzy/substring match in persistent mappings
        if (mappings) {
            const foundKey = Object.keys(mappings).find(k => k === cLower || k.includes(cLower) || cLower.includes(k));
            if (foundKey && mappings[foundKey]?.item_id) {
                return {
                    id: mappings[foundKey].item_id,
                    name: mappings[foundKey].item_name || '',
                };
            }
        }

        // 3. LocalStorage direct check for instant client persistence
        try {
            const raw = localStorage.getItem(`ck_mapping_${cLower}`);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.item_id) {
                    return { id: parsed.item_id, name: parsed.item_name || '' };
                }
            }
        } catch (e) {}

        // 4. Cut master flat collection
        const masterCut = (cutsMasterList || []).find(m => (m.name || '').toLowerCase().trim() === cLower);
        if (masterCut?.default_ck_item_id) {
            return {
                id: masterCut.default_ck_item_id,
                name: masterCut.default_ck_item_name || '',
            };
        }

        // 5. Smart match with active CK raw_meat items (e.g. "Mix Lamb" -> "Lamb Mix", "Mince" -> "Lamb Mince")
        const auto = findAutoCKItem(cutName, loadedCkItems);
        if (auto) {
            return {
                id: auto.id,
                name: auto.name,
            };
        }

        return { id: '', name: '' };
    };

    // Calculate proportional cuts based on amount to butcher
    const applyProportionalCuts = (batch, butcherAmount, animalsList = animals, cutsMasterList = cutMaster, loadedCkItems = ckItems, mappingsToUse = savedCKMappings) => {
        if (!batch) return;
        const matchedAnimal = findMatchingAnimal(batch, animalsList);
        const parentNo = batch.batch_number || batch.id;
        const amt = safeNum(butcherAmount, 0);

        if (matchedAnimal && matchedAnimal.cut_types && matchedAnimal.cut_types.length > 0) {
            const baseWeight = safeNum(matchedAnimal.base_weight, 1);
            const ratio = amt > 0 && baseWeight > 0 ? amt / baseWeight : 1;

            const rows = matchedAnimal.cut_types.map((ct, i) => {
                const stdWeight = safeNum(ct.std_weight_kg, 0);
                const proportionalWeight = Math.round(stdWeight * ratio * 100) / 100;
                const code = (ct.name || 'CUT').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
                const mapping = resolveCutMapping(ct.name, ct, cutsMasterList, loadedCkItems, mappingsToUse);

                return {
                    id: newRowId(),
                    cut_name: ct.name,
                    weight_kg: proportionalWeight,
                    is_waste: Boolean(ct.is_waste),
                    shelf_life_days: safeNum(ct.shelf_life_days, 5),
                    child_batch_no: `${parentNo}-${code}-${i + 1}`,
                    destination_item_id: mapping.id,
                    destination_item_name: mapping.name,
                };
            });

            setCuts(rows);
        } else {
            // Fallback to cut types from flat collection
            const animalType = detectAnimalType(batch);
            const filtered = animalType
                ? cutsMasterList.filter(c => (c.animal_type || '').toLowerCase() === animalType.toLowerCase())
                : cutsMasterList;
            const listToUse = filtered.length > 0 ? filtered : cutsMasterList.slice(0, 5);

            const totalStdWeight = listToUse.reduce((s, c) => s + safeNum(c.std_weight_kg, 2), 0);

            const rows = listToUse.map((c, i) => {
                const stdWeight = safeNum(c.std_weight_kg, 2);
                const proportion = totalStdWeight > 0 ? stdWeight / totalStdWeight : (listToUse.length > 0 ? 1 / listToUse.length : 1);
                const propWeight = Math.round(amt * proportion * 100) / 100;
                const code = (c.name || 'CUT').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
                const mapping = resolveCutMapping(c.name, c, cutsMasterList, loadedCkItems, mappingsToUse);

                return {
                    id: newRowId(),
                    cut_name: c.name,
                    weight_kg: propWeight > 0 ? propWeight : 0,
                    is_waste: Boolean(c.is_waste),
                    shelf_life_days: safeNum(c.shelf_life_days, 5),
                    child_batch_no: `${parentNo}-${code}-${i + 1}`,
                    destination_item_id: mapping.id,
                    destination_item_name: mapping.name,
                };
            });

            setCuts(rows);
        }
    };

    const load = async () => {
        setLoading(true);
        try {
            const [batchList, cutList, animalList, itemsList, mappings] = await Promise.all([
                getButcherInventory(),
                getCutTypes(),
                getAnimals(),
                getItems({ status: 'active' }),
                getCutCKMappings(),
            ]);

            const sanitizedBatches = (batchList || []).map(sanitize);
            const sanitizedCuts = (cutList || []).map(sanitize);
            const sanitizedAnimals = animalList || [];
            // A butchered cut must map to a meat item, never grocery inventory.
            const activeCkItems = (itemsList || []).filter(item => ['raw_meat', 'cooked_meat'].includes(item.item_type));

            setBatches(sanitizedBatches);
            setCutMaster(sanitizedCuts);
            setAnimals(sanitizedAnimals);
            setCkItems(activeCkItems);
            setSavedCKMappings(mappings || {});

            let initialBatch = sanitizedBatches[0] || null;
            if (preselectedId) {
                initialBatch = sanitizedBatches.find(b => b.id === preselectedId) || initialBatch;
            }

            if (initialBatch) {
                setSelectedBatchId(initialBatch.id);
                setSelectedBatch(initialBatch);
                const availableWeight = safeNum(initialBatch.remaining_weight_kg ?? initialBatch.quantity ?? initialBatch.weight_kg ?? initialBatch.initial_quantity, 10);
                setAmountToButcher(String(availableWeight));
                applyProportionalCuts(initialBatch, availableWeight, sanitizedAnimals, sanitizedCuts, activeCkItems, mappings || {});
                const aType = detectAnimalType(initialBatch);
                if (aType && ['Lamb', 'Chicken', 'Beef', 'Mutton', 'Goat', 'Seafood'].includes(aType)) {
                    setCkCategoryFilter(aType);
                }
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
        if (selectedBatch && safeNum(val) >= 0) {
            applyProportionalCuts(selectedBatch, safeNum(val), animals, cutMaster, ckItems, savedCKMappings);
        }
    };

    const handleBatchChange = (id) => {
        setSelectedBatchId(id);
        const found = batches.find(b => b.id === id);
        setSelectedBatch(found || null);
        if (found) {
            const availableWeight = safeNum(found.remaining_weight_kg ?? found.quantity ?? found.weight_kg ?? found.initial_quantity, 10);
            setAmountToButcher(String(availableWeight));
            applyProportionalCuts(found, availableWeight, animals, cutMaster, ckItems, savedCKMappings);
            const aType = detectAnimalType(found);
            if (aType && ['Lamb', 'Chicken', 'Beef', 'Mutton', 'Goat', 'Seafood'].includes(aType)) {
                setCkCategoryFilter(aType);
            }
        }
    };

    const currentAnimal = detectAnimalType(selectedBatch);
    const matchedAnimalMaster = findMatchingAnimal(selectedBatch, animals);

    const getAvailableCutTypes = () => {
        const animalCuts = matchedAnimalMaster?.cut_types || [];
        const baseOptions = animalCuts.map(c => ({
            name: c.name,
            animal_type: matchedAnimalMaster?.animal_type || 'Other',
            is_waste: Boolean(c.is_waste),
            shelf_life_days: c.shelf_life_days || 5,
            std_weight_kg: c.std_weight_kg || 0,
        }));

        const masterFiltered = (showAllCuts || !currentAnimal)
            ? cutMaster
            : cutMaster.filter(c => {
                const cutAnimal = (c.animal_type || '').toLowerCase();
                const targetAnimal = currentAnimal.toLowerCase();
                if (targetAnimal === 'mutton' || targetAnimal === 'lamb') {
                    return cutAnimal === 'mutton' || cutAnimal === 'lamb' || cutAnimal === 'other';
                }
                return cutAnimal === targetAnimal || cutAnimal === 'other';
            });

        // Deduplicate
        const combined = [...baseOptions];
        masterFiltered.forEach(m => {
            if (!combined.some(c => (c.name || '').toLowerCase() === (m.name || '').toLowerCase())) {
                combined.push(m);
            }
        });

        return combined.length > 0 ? combined : cutMaster;
    };

    // Metrics
    const parentWeight = safeNum(selectedBatch?.remaining_weight_kg ?? selectedBatch?.quantity ?? selectedBatch?.weight_kg ?? selectedBatch?.initial_quantity, 0);
    const butcherAmt = safeNum(amountToButcher, 0);
    const usableWeight = Math.round(cuts.filter(c => !c.is_waste).reduce((s, c) => s + safeNum(c.weight_kg), 0) * 100) / 100;
    const wasteWeight = Math.round(cuts.filter(c => c.is_waste).reduce((s, c) => s + safeNum(c.weight_kg), 0) * 100) / 100;
    const allocated = Math.round((usableWeight + wasteWeight) * 100) / 100;
    const remaining = Math.max(0, Math.round((butcherAmt - allocated) * 100) / 100);
    const yieldPct = butcherAmt > 0 ? Math.round((usableWeight / butcherAmt) * 10000) / 100 : 0;
    const isOverAllocated = allocated > butcherAmt + 0.05;

    const addRow = () => {
        const available = getAvailableCutTypes();
        const defaultCut = available[0] || cutMaster[0] || { name: 'Cut', is_waste: false, shelf_life_days: 5 };
        const parentNo = selectedBatch?.batch_number || 'BAT';
        const code = (defaultCut?.name || 'CUT').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
        const unallocatedLeft = Math.max(0, butcherAmt - allocated);
        const initialWeight = unallocatedLeft > 0 ? Math.round(unallocatedLeft * 100) / 100 : 1.0;
        const mapping = resolveCutMapping(defaultCut?.name || 'Cut', defaultCut, cutMaster, ckItems, savedCKMappings);

        setCuts(p => [...p, {
            id: newRowId(),
            cut_name: defaultCut?.name || 'Cut',
            weight_kg: initialWeight,
            is_waste: Boolean(defaultCut?.is_waste),
            shelf_life_days: safeNum(defaultCut?.shelf_life_days, 5),
            child_batch_no: `${parentNo}-${code}-${p.length + 1}`,
            destination_item_id: mapping.id,
            destination_item_name: mapping.name,
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
                const available = getAvailableCutTypes();
                const master = available.find(m => m.name === value) || cutMaster.find(m => m.name === value);
                if (master) {
                    updated.is_waste = Boolean(master.is_waste);
                    updated.shelf_life_days = safeNum(master.shelf_life_days, c.shelf_life_days);
                }
                const mapping = resolveCutMapping(value, master, cutMaster, ckItems, savedCKMappings);
                updated.destination_item_id = mapping.id;
                updated.destination_item_name = mapping.name;

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
            toast.error(`Cannot save: Total allocated (${formatKg(allocated)} kg) exceeds amount to butcher (${formatKg(butcherAmt)} kg)!`);
            return;
        }
        if (usableWeight <= 0) {
            toast.error('At least one usable cut with weight > 0 kg is required');
            return;
        }
        setSaving(true);
        try {
            const result = await createButcheringOrder({
                sourceBatch: selectedBatch,
                butcherName,
                date,
                cuts,
                notes,
                processing_weight_kg: butcherAmt,
            });
            toast.success(`Order ${result.order_no} created — ${result.child_batches?.length || 0} child batches generated!`);
            setCreatedOrder(result);

            // Persist any CK mappings the user selected so they auto-populate next time
            for (const cut of cuts) {
                if (cut.destination_item_id && cut.cut_name && !cut.is_waste) {
                    saveCutCKMapping(cut.cut_name, cut.destination_item_id, cut.destination_item_name || '')
                        .catch(err => console.warn('Failed to persist CK mapping for', cut.cut_name, err));
                }
            }
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
                        {childBatches.length} child batches created • Yield: {Number(order.yield_pct || 0).toFixed(2)}%
                    </p>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                        Input: {formatKg(order.input_weight_kg)} kg → Usable: {formatKg(order.output_weight_kg)} kg • Waste: {formatKg(order.waste_weight_kg)} kg
                    </p>

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
                        <button className="btn btn-primary btn-md" onClick={() => { setCreatedOrder(null); load(); }}>
                            <MdAdd /> New Butchering Order
                        </button>
                        <button className="btn btn-secondary btn-md" onClick={() => navigate('/butchering/inventory')}>
                            <MdInventory2 /> View Butcher Inventory
                        </button>
                        <button className="btn btn-secondary btn-md" onClick={() => navigate('/butchering/history')}>
                            View History
                        </button>
                    </div>
                </div>

                {/* QR Codes & Mapping */}
                {childBatches.length > 0 && (
                    <div className="butcher-panel" style={{ marginTop: 24 }}>
                        <h3 className="butcher-panel-title"><MdQrCodeScanner /> Generated Cut Batches &amp; QR Labels</h3>
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
                                        {batch.cut_name || batch.item_name} — {formatKg(batch.quantity)} kg
                                        {batch.is_waste && <span style={{ color: '#ef4444' }}> (Waste)</span>}
                                    </div>
                                    {batch.item_id ? (
                                        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-success)', fontWeight: 600 }}>
                                            ✅ Mapped to CK Inventory
                                        </div>
                                    ) : null}
                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
                                        {!batch.is_waste && (
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => setMappingBatch(batch)}
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                            >
                                                <MdSyncAlt size={12} /> {batch.item_id ? 'Remap to CK' : 'Map to CK'}
                                            </button>
                                        )}
                                        <button className="btn btn-secondary btn-sm"
                                            onClick={() => {
                                                toast.success('Print from browser print dialog');
                                                window.print();
                                            }}>
                                            <MdPrint size={12} /> Print
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Map to CK Modal */}
                <MapCutToCKModal
                    cutBatch={mappingBatch}
                    isOpen={Boolean(mappingBatch)}
                    onClose={() => setMappingBatch(null)}
                    onSuccess={() => load()}
                />
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
                        Select meat from inventory, specify cut weights and destination Central Kitchen (CK) mappings
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="butcher-loading">Loading raw meat batches, cut types, and CK inventory items...</div>
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
                        <h3 className="butcher-panel-title">1. Select Source Batch &amp; Butcher Details</h3>

                        {/* Category Filters & Search Bar */}
                        <div className="batch-filter-bar">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                <div className="batch-category-pills">
                                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <MdFilterList /> Filter Species:
                                    </span>
                                    {Object.keys(batchCategories).map(cat => {
                                        const count = batchCategories[cat];
                                        const label = cat === 'ALL' ? 'All Items' : cat;
                                        const isActive = batchCategoryFilter === cat;
                                        return (
                                            <button
                                                key={cat}
                                                type="button"
                                                className={`batch-category-pill ${isActive ? 'active' : ''}`}
                                                onClick={() => handleCategoryFilterChange(cat)}
                                            >
                                                {cat === 'Lamb' && '🐑 '}
                                                {cat === 'Mutton' && '🐐 '}
                                                {cat === 'Chicken' && '🍗 '}
                                                {cat === 'Beef' && '🥩 '}
                                                {cat === 'Goat' && '🐐 '}
                                                {cat === 'Seafood' && '🐟 '}
                                                {label}
                                                <span className="pill-count">{count}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="batch-search-row">
                                <div className="batch-search-input-wrap">
                                    <MdSearch className="search-icon" />
                                    <input
                                        type="text"
                                        className="batch-search-input"
                                        placeholder="Search by product name, cut, batch number, or vendor (e.g. Lamb, BT-RM-..., Ribs)..."
                                        value={batchSearchTerm}
                                        onChange={e => handleBatchSearchChange(e.target.value)}
                                    />
                                    {batchSearchTerm && (
                                        <button
                                            type="button"
                                            className="clear-icon"
                                            onClick={() => { setBatchSearchTerm(''); }}
                                            title="Clear search"
                                        >
                                            <MdClose size={18} />
                                        </button>
                                    )}
                                </div>
                                {(batchCategoryFilter !== 'ALL' || batchSearchTerm) && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => { setBatchCategoryFilter('ALL'); setBatchSearchTerm(''); }}
                                        style={{ whiteSpace: 'nowrap' }}
                                    >
                                        Reset Filter ({filteredBatches.length} items)
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="form-row-3">
                            <div className="form-field">
                                <label>
                                    Source Meat Batch *
                                    <span style={{ fontSize: 11, fontWeight: 'normal', color: 'var(--color-text-muted)', marginLeft: 6 }}>
                                        ({filteredBatches.length} {filteredBatches.length === 1 ? 'batch' : 'batches'} matching)
                                    </span>
                                </label>
                                <select className="form-select" value={selectedBatchId} onChange={e => handleBatchChange(e.target.value)}>
                                    {filteredBatches.length === 0 ? (
                                        <option value="">No batches found matching filter or search</option>
                                    ) : (
                                        filteredBatches.map(b => {
                                            const batchAvail = safeNum(b.remaining_weight_kg ?? b.quantity ?? b.weight_kg ?? b.initial_quantity, 10);
                                            const animal = detectAnimalType(b) || 'Meat';
                                            return (
                                                <option key={b.id} value={b.id}>
                                                    {b.batch_number || b.id} — {b.item_name} ({formatKg(batchAvail)} kg) · {animal}
                                                </option>
                                            );
                                        })
                                    )}
                                    {selectedBatch && !filteredBatches.some(b => b.id === selectedBatch.id) && (
                                        <option value={selectedBatch.id}>
                                            [Selected] {selectedBatch.batch_number || selectedBatch.id} — {selectedBatch.item_name} ({formatKg(parentWeight)} kg)
                                        </option>
                                    )}
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
                                    { icon: <MdInventory2 />, label: 'Available', value: `${formatKg(parentWeight)} kg`, color: 'var(--color-success)' },
                                    { icon: <MdStore />, label: 'Vendor', value: selectedBatch.vendor_name || selectedBatch.supplier || '—' },
                                    { icon: <MdCalendarToday />, label: 'Animal Type', value: currentAnimal || 'Unknown', color: 'var(--color-primary)' },
                                    ...(matchedAnimalMaster ? [{ icon: <MdInfo />, label: 'Template', value: `${matchedAnimalMaster.name} (${formatKg(matchedAnimalMaster.base_weight)} ${matchedAnimalMaster.base_unit})`, color: 'var(--color-primary)' }] : []),
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
                                    step="0.01"
                                    min="0.01"
                                    max={parentWeight}
                                    value={amountToButcher}
                                    onChange={e => handleAmountChange(e.target.value)}
                                    style={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }}
                                />
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', paddingBottom: 10 }}>
                                out of <strong style={{ color: 'var(--color-success)' }}>{formatKg(parentWeight)} kg</strong> available
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
                                    ({formatKg(matchedAnimalMaster.base_weight)} {matchedAnimalMaster.base_unit} base → {matchedAnimalMaster.cut_types?.length || 0} cuts)
                                </div>
                            )}
                        </div>
                        {(matchedAnimalMaster?.allowed_butchering_quantities || []).length > 0 && (
                            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>Suggested quantities:</span>
                                {matchedAnimalMaster.allowed_butchering_quantities.filter(q => Number(q) <= parentWeight).map(q => (
                                    <button key={q} type="button" className="btn btn-secondary btn-sm" onClick={() => handleAmountChange(String(q))}>{formatKg(q)} kg</button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Section 3: Cut Output Rows & CK Mapping */}
                    <div className="butcher-panel" style={{ marginTop: 20 }}>
                        <div className="butcher-panel-header">
                            <div>
                                <h3 className="butcher-panel-title">3. Cut Output &amp; CK Inventory Mapping — {cuts.length} cuts</h3>
                                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                    Select cut types, adjust weights, and choose destination CK inventory items to automatically sync stock
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                                    <input type="checkbox" checked={showAllCuts} onChange={e => setShowAllCuts(e.target.checked)} />
                                    Show all cut types
                                </label>
                                <button className="btn btn-secondary btn-sm" onClick={addRow}><MdAdd /> Add Cut</button>
                            </div>
                        </div>

                        {/* Category Filters for CK Inventory Mapping */}
                        <div className="batch-filter-bar" style={{ marginTop: 14, marginBottom: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <MdFilterList /> Filter Destination CK Categories:
                                </span>
                                {ckCategoryFilter !== 'ALL' && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setCkCategoryFilter('ALL')}
                                        style={{ fontSize: 11, padding: '2px 8px' }}
                                    >
                                        Reset to All ({ckItems.length} items)
                                    </button>
                                )}
                            </div>
                            <div className="batch-category-pills">
                                {ckCategories.map(cat => (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        className={`batch-category-pill ${ckCategoryFilter === cat.id ? 'active' : ''}`}
                                        onClick={() => setCkCategoryFilter(cat.id)}
                                    >
                                        <span className="pill-name">{cat.icon} {cat.label}</span>
                                        <span className="pill-count">{cat.count}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="butcher-table-wrap">
                            <table className="butcher-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '20%' }}>CUT TYPE</th>
                                        <th style={{ width: '10%' }}>WEIGHT (kg)</th>
                                        <th style={{ width: '32%' }}>MAP TO CK INVENTORY</th>
                                        <th style={{ width: '9%' }}>SHELF LIFE</th>
                                        <th style={{ width: '8%' }}>TYPE</th>
                                        <th style={{ width: '17%' }}>CHILD BATCH #</th>
                                        <th style={{ width: 40 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cuts.map(cut => {
                                        const rowCat = cut.category_filter || ckCategoryFilter;
                                        const rowFilteredCkItems = ckItems.filter(item => itemMatchesCkCategory(item, rowCat));
                                        const selectedItem = cut.destination_item_id ? ckItems.find(i => i.id === cut.destination_item_id) : null;
                                        const isSelectedOutsideFilter = selectedItem && !rowFilteredCkItems.some(i => i.id === selectedItem.id);

                                        return (
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
                                                        step="0.01" min="0" value={cut.weight_kg}
                                                        onChange={e => updateRow(cut.id, 'weight_kg', e.target.value)} />
                                                </td>
                                                <td>
                                                    {cut.is_waste ? (
                                                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>— Waste / Non-stock —</span>
                                                    ) : (
                                                        <div style={{ display: 'grid', gap: 5 }}>
                                                            {/* Row 1: Category filter dropdown + Search input with clear button */}
                                                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                                <select
                                                                    className="table-cell-select"
                                                                    value={cut.category_filter || ckCategoryFilter}
                                                                    onChange={e => updateRow(cut.id, 'category_filter', e.target.value)}
                                                                    style={{
                                                                        width: '42%',
                                                                        minWidth: 105,
                                                                        fontSize: 11,
                                                                        padding: '4px 6px',
                                                                        background: 'var(--color-bg)',
                                                                        borderColor: (cut.category_filter && cut.category_filter !== 'ALL') || ckCategoryFilter !== 'ALL' ? 'var(--color-primary)' : 'var(--color-border)',
                                                                        color: 'var(--color-text-primary)'
                                                                    }}
                                                                    title="Category filter for this cut"
                                                                >
                                                                    {ckCategories.map(c => (
                                                                        <option key={c.id} value={c.id}>
                                                                            {c.icon} {c.label} ({c.count})
                                                                        </option>
                                                                    ))}
                                                                </select>

                                                                <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                                                                    <input
                                                                        className="table-cell-input"
                                                                        list={`ck-map-search-${cut.id}`}
                                                                        value={cut.destination_item_name || ''}
                                                                        placeholder="Search CK meat item…"
                                                                        aria-label="Search CK meat inventory"
                                                                        style={{
                                                                            width: '100%',
                                                                            fontSize: 12,
                                                                            paddingRight: cut.destination_item_name ? 24 : 8,
                                                                            paddingLeft: 8
                                                                        }}
                                                                        onChange={e => {
                                                                            const name = e.target.value;
                                                                            const found = ckItems.find(item => (item.name || '').toLowerCase().trim() === name.toLowerCase().trim());
                                                                            const selId = found?.id || '';
                                                                            setCuts(p => p.map(c => c.id === cut.id ? { ...c, destination_item_name: name, destination_item_id: selId } : c));
                                                                            // Update state & persist for future orders
                                                                            if (cut.cut_name && (found?.id || !name)) {
                                                                                const k = cut.cut_name.toLowerCase().trim();
                                                                                setSavedCKMappings(prev => ({ ...prev, [k]: { item_id: found?.id || '', item_name: found?.name || '' } }));
                                                                                if (found?.id) {
                                                                                    saveCutCKMapping(cut.cut_name, found.id, found.name)
                                                                                        .catch(err => console.warn('Auto-persist CK mapping failed:', err));
                                                                                }
                                                                            }
                                                                        }}
                                                                    />
                                                                    {cut.destination_item_name && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setCuts(p => p.map(c => c.id === cut.id ? { ...c, destination_item_id: '', destination_item_name: '' } : c));
                                                                            }}
                                                                            style={{
                                                                                position: 'absolute',
                                                                                right: 6,
                                                                                top: '50%',
                                                                                transform: 'translateY(-50%)',
                                                                                background: 'transparent',
                                                                                border: 'none',
                                                                                color: 'var(--color-text-muted)',
                                                                                cursor: 'pointer',
                                                                                padding: 2,
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                            }}
                                                                            title="Clear selection"
                                                                        >
                                                                            <MdClose size={13} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <datalist id={`ck-map-search-${cut.id}`}>
                                                                {rowFilteredCkItems.map(item => (
                                                                    <option key={item.id} value={item.name}>
                                                                        {item.item_type === 'raw_meat' ? '🥩 Raw meat' : '🍛 Cooked'} · {item.category_name || item.sku || 'CK inventory'} ({formatKg(item.current_stock)} {item.unit || 'kg'})
                                                                    </option>
                                                                ))}
                                                            </datalist>

                                                            {/* Row 2: Select dropdown */}
                                                            <select
                                                                className="table-cell-select"
                                                                title="Select a CK meat item"
                                                                style={{
                                                                    width: '100%',
                                                                    borderColor: cut.destination_item_id ? 'var(--color-primary)' : 'var(--color-border)',
                                                                    fontSize: 12
                                                                }}
                                                                value={cut.destination_item_id || ''}
                                                                onChange={e => {
                                                                    const selId = e.target.value;
                                                                    const found = ckItems.find(item => item.id === selId);
                                                                    setCuts(p => p.map(c => c.id === cut.id ? { ...c, destination_item_id: selId, destination_item_name: found?.name || '' } : c));
                                                                    // Update state & persist for future orders
                                                                    if (cut.cut_name) {
                                                                        const k = cut.cut_name.toLowerCase().trim();
                                                                        setSavedCKMappings(prev => ({ ...prev, [k]: { item_id: selId, item_name: found?.name || '' } }));
                                                                        if (selId) {
                                                                            saveCutCKMapping(cut.cut_name, selId, found?.name || '')
                                                                                .catch(err => console.warn('Auto-persist CK mapping failed:', err));
                                                                        }
                                                                    }
                                                                }}
                                                            >
                                                                <option value="">— Butcher Cut Meat Inventory Storage —</option>
                                                                {isSelectedOutsideFilter && (
                                                                    <option value={selectedItem.id}>
                                                                        {selectedItem.item_type === 'raw_meat' ? '🥩' : '📦'} {selectedItem.name} ({formatKg(selectedItem.current_stock)} {selectedItem.unit || 'kg'} in CK) [Selected]
                                                                    </option>
                                                                )}
                                                                {rowFilteredCkItems.map(item => (
                                                                    <option key={item.id} value={item.id}>
                                                                        {item.item_type === 'raw_meat' ? '🥩' : '📦'} {item.name} ({formatKg(item.current_stock)} {item.unit || 'kg'} in CK)
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    )}
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
                                    );
                                })}
                                </tbody>
                            </table>
                        </div>

                        {/* Yield Dashboard */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginTop: 20 }}>
                            {[
                                { label: 'To Butcher', value: `${formatKg(butcherAmt)} kg`, color: 'var(--color-text-primary)' },
                                { label: 'Usable Cuts', value: `${formatKg(usableWeight)} kg`, color: '#22c55e' },
                                { label: 'Waste', value: `${formatKg(wasteWeight)} kg`, color: '#ef4444' },
                                { label: 'Allocated', value: `${formatKg(allocated)} kg`, color: isOverAllocated ? '#ef4444' : 'var(--color-primary)' },
                                { label: 'Remaining', value: `${formatKg(remaining)} kg`, color: remaining > 0 ? '#f59e0b' : '#22c55e' },
                                { label: 'Yield', value: `${yieldPct.toFixed(2)}%`, color: yieldPct >= 80 ? '#22c55e' : yieldPct >= 60 ? '#f59e0b' : '#ef4444' },
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
                                Over-allocated by <strong>{formatKg(allocated - butcherAmt)} kg</strong>. Reduce cut weights before saving.
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
