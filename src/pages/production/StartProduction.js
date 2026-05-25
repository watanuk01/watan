import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
    getCookedMeatItems,
    scaleRecipe,
    checkIngredientAvailability,
    startProduction,
} from '../../services/productionService';
import {
    MdOutlineKitchen,
    MdPlayArrow,
    MdCheckCircle,
    MdWarning,
    MdArrowForward,
    MdArrowBack,
    MdSearch,
    MdClose,
    MdPictureAsPdf,
} from 'react-icons/md';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import toast from 'react-hot-toast';
import './Production.css';

const DRAFT_KEY = 'watan_production_draft';

const saveDraft = (data) => {
    try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
};

const loadDraft = () => {
    try {
        const raw = sessionStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
};

const clearDraft = () => {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
};

const StartProduction = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [step, setStep] = useState(1); // 1=select item, 2=select qty, 3=review & confirm
    const [cookedItems, setCookedItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedItem, setSelectedItem] = useState(null);
    const [selectedQty, setSelectedQty] = useState(null);
    const [scaledIngredients, setScaledIngredients] = useState([]);
    const [ingredientCheck, setIngredientCheck] = useState([]);
    const [checkingStock, setCheckingStock] = useState(false);
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const draftRestored = useRef(false);

    // Company Info for PDF
    const COMPANY = {
        name: 'Watan Central Kitchen',
        address: '123 High Street, London, UK',
        phone: '+44 20 1234 5678',
        email: 'orders@watan.com',
    };

    // Load cooked meat items
    useEffect(() => {
        const fetch = async () => {
            setLoading(true);
            try {
                const items = await getCookedMeatItems();
                setCookedItems(items);

                // Restore draft if exists
                if (!draftRestored.current) {
                    draftRestored.current = true;
                    const draft = loadDraft();
                    if (draft && draft.selectedItemId) {
                        const item = items.find(i => i.id === draft.selectedItemId);
                        if (item) {
                            setSelectedItem(item);
                            setStep(draft.step || 2);
                            setNotes(draft.notes || '');
                            if (draft.selectedQty) {
                                // Re-trigger qty selection to refresh stock
                                setSelectedQty(draft.selectedQty);
                                const scaled = scaleRecipe(item.recipe, draft.selectedQty);
                                setScaledIngredients(scaled);
                                // Check stock in background
                                setCheckingStock(true);
                                checkIngredientAvailability(scaled).then(avail => {
                                    setIngredientCheck(avail);
                                }).catch(() => {
                                    toast.error('Failed to restore stock data');
                                }).finally(() => {
                                    setCheckingStock(false);
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                toast.error('Failed to load cooked meat items');
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Save draft on state changes
    useEffect(() => {
        if (selectedItem) {
            saveDraft({
                selectedItemId: selectedItem.id,
                selectedQty,
                step,
                notes,
            });
        }
    }, [selectedItem, selectedQty, step, notes]);

    // When qty is selected, scale recipe and check stock
    const handleQtySelect = useCallback(async (qty) => {
        setSelectedQty(qty);
        if (!selectedItem) return;

        const scaled = scaleRecipe(selectedItem.recipe, qty);
        setScaledIngredients(scaled);

        setCheckingStock(true);
        try {
            const availability = await checkIngredientAvailability(scaled);
            setIngredientCheck(availability);
        } catch (err) {
            toast.error('Failed to check stock availability');
        } finally {
            setCheckingStock(false);
        }
    }, [selectedItem]);

    const allSufficient = ingredientCheck.length > 0 && ingredientCheck.every(i => i.sufficient);

    const handleSelectItem = (item) => {
        setSelectedItem(item);
        setSelectedQty(null);
        setScaledIngredients([]);
        setIngredientCheck([]);
        setStep(2);
    };

    const handleStartProduction = async () => {
        if (!selectedItem || !selectedQty) return;

        // ── Final guard: must have all ingredients sufficient ──
        if (!allSufficient) {
            toast.error('Cannot start: one or more ingredients have insufficient stock.');
            return;
        }

        setSubmitting(true);
        try {
            const result = await startProduction({
                item_id: selectedItem.id,
                item_name: selectedItem.name,
                item_unit: selectedItem.unit,
                production_quantity: selectedQty,
                recipe: selectedItem.recipe,
                scaled_ingredients: ingredientCheck,
                chef_name: user?.name || user?.email || '',
                chef_id: user?.uid || '',
                notes,
            });

            clearDraft();
            toast.success(`Production ${result.production_number} started! Ingredients deducted.`);
            navigate('/production/in-progress');
        } catch (err) {
            toast.error(err.message || 'Failed to start production');
        } finally {
            setSubmitting(false);
        }
    };

    const getTypeIcon = (type) => type === 'raw_meat' ? '🥩' : '🛒';

    // Generate Production Batch PDF
    const generateBatchPdf = () => {
        if (!selectedItem || !selectedQty) return;

        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();

        // Company Header
        doc.setFillColor(44, 62, 80);
        doc.rect(0, 0, pageWidth, 38, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(COMPANY.name, 15, 18);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(COMPANY.address, 15, 25);
        doc.text(`Phone: ${COMPANY.phone}  |  Email: ${COMPANY.email}`, 15, 31);

        // Title
        doc.setTextColor(44, 62, 80);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('PRODUCTION BATCH', 15, 50);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), pageWidth - 15, 50, { align: 'right' });

        doc.setDrawColor(200, 200, 200);
        doc.line(15, 54, pageWidth - 15, 54);

        // Production Info
        let y = 62;
        doc.setFontSize(10);
        doc.setTextColor(80, 80, 80);
        const scaleFactor = (selectedQty / selectedItem.recipe.base_batch_size).toFixed(1);
        const info = [
            ['Item', selectedItem.name],
            ['Production Quantity', `${selectedQty} ${selectedItem.unit || 'kg'}`],
            ['Base Batch Size', `${selectedItem.recipe.base_batch_size} ${selectedItem.recipe.base_batch_unit || 'kg'}`],
            ['Scale Factor', `${scaleFactor}× base recipe`],
            ['Chef', user?.name || user?.email || 'Unknown'],
            ['Total Ingredients', `${ingredientCheck.length} items`],
        ];
        if (notes) info.push(['Notes', notes]);

        info.forEach(([label, value]) => {
            doc.setFont('helvetica', 'bold');
            doc.text(`${label}:`, 15, y);
            doc.setFont('helvetica', 'normal');
            doc.text(String(value), 60, y);
            y += 6;
        });

        y += 6;

        // Ingredients Table
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(44, 62, 80);
        doc.text('Ingredients to be Deducted', 15, y);
        y += 4;

        const rows = ingredientCheck.map((ing, idx) => [
            idx + 1,
            ing.item_name,
            ing.item_type === 'raw_meat' ? 'Raw Meat' : 'Grocery',
            `${ing.scaled_sub_quantity} ${ing.unit}`,
            ing.missing ? '---' : `${ing.available_stock.toFixed(2)} ${ing.master_unit}`,
            ing.missing ? 'Missing' : ing.sufficient ? 'OK' : 'Low',
        ]);

        autoTable(doc, {
            head: [['#', 'Ingredient', 'Type', 'Required', 'Available', 'Status']],
            body: rows,
            startY: y,
            theme: 'grid',
            headStyles: { fillColor: [44, 62, 80], fontSize: 9 },
            styles: { fontSize: 9, cellPadding: 3 },
            columnStyles: {
                0: { cellWidth: 10 },
                5: { halign: 'center' },
            },
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 5) {
                    const val = data.cell.raw;
                    if (val === 'OK') data.cell.styles.textColor = [34, 197, 94];
                    else if (val === 'Low') data.cell.styles.textColor = [239, 68, 68];
                    else if (val === 'Missing') data.cell.styles.textColor = [239, 68, 68];
                    data.cell.styles.fontStyle = 'bold';
                }
            },
        });

        // Footer
        const footerY = doc.internal.pageSize.getHeight() - 12;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.setFont('helvetica', 'italic');
        doc.text(`Generated on ${new Date().toLocaleDateString('en-GB')} — ${COMPANY.name}`, pageWidth / 2, footerY, { align: 'center' });

        doc.save(`Production_Batch_${selectedItem.name.replace(/\s+/g, '_')}_${selectedQty}${selectedItem.unit || 'kg'}.pdf`);
        toast.success('Production batch PDF downloaded');
    };

    const allowedQtys = selectedItem?.allowed_production_quantities || [];

    const uniqueCategories = Array.from(
        new Set(cookedItems.map(item => item.category_name).filter(Boolean))
    ).sort();

    // ── Filtered items for search & category ──
    const filteredItems = cookedItems.filter(item => {
        if (selectedCategory !== 'All' && item.category_name !== selectedCategory) return false;
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            (item.name || '').toLowerCase().includes(q) ||
            (item.category_name || '').toLowerCase().includes(q)
        );
    });

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdOutlineKitchen style={{ marginRight: 'var(--space-2)' }} />
                        Start New Production
                    </h1>
                    <p className="page-subtitle">Select a cooked meat item and quantity to begin production</p>
                </div>
                <button className="btn btn-secondary btn-md" onClick={() => navigate('/production/in-progress')}>
                    View In Progress
                </button>
            </div>

            {/* Step Indicators */}
            <div className="prod-steps">
                <div className={`prod-step ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
                    <span className="prod-step-number">{step > 1 ? '✓' : '1'}</span>
                    Select Item
                </div>
                <div className={`prod-step ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`}>
                    <span className="prod-step-number">{step > 2 ? '✓' : '2'}</span>
                    Choose Quantity
                </div>
                <div className={`prod-step ${step === 3 ? 'active' : ''}`}>
                    <span className="prod-step-number">3</span>
                    Review & Start
                </div>
            </div>

            {/* ═══ Step 1: Select Item ═══ */}
            {step === 1 && (
                <>
                    {/* Search bar */}
                    <div className="prod-search-bar">
                        <MdSearch className="prod-search-icon" />
                        <input
                            type="text"
                            className="prod-search-input"
                            placeholder="Search cooked meat items by name or category..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button
                                className="prod-search-clear"
                                onClick={() => setSearchQuery('')}
                                title="Clear search"
                            >
                                <MdClose />
                            </button>
                        )}
                    </div>

                    {/* Category Filters */}
                    {uniqueCategories.length > 0 && (
                        <div className="category-chips" style={{ marginBottom: 'var(--space-4)' }}>
                            <button
                                className={`category-chip ${selectedCategory === 'All' ? 'active' : ''}`}
                                onClick={() => setSelectedCategory('All')}
                            >
                                All
                            </button>
                            {uniqueCategories.map(cat => (
                                <button
                                    key={cat}
                                    className={`category-chip ${selectedCategory === cat ? 'active' : ''}`}
                                    onClick={() => setSelectedCategory(cat)}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    )}

                    {loading ? (
                        <div className="prod-item-select-grid">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="prod-item-card">
                                    <div className="skeleton skeleton-text" style={{ width: '60%', height: 20 }} />
                                    <div className="skeleton skeleton-text" style={{ width: '40%', height: 14, marginTop: 8 }} />
                                    <div className="skeleton skeleton-text" style={{ width: '50%', height: 14, marginTop: 8 }} />
                                </div>
                            ))}
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                            <MdOutlineKitchen style={{ fontSize: 48, color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }} />
                            <h3 style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                                {searchQuery ? 'No items match your search' : 'No Cooked Meat Items Found'}
                            </h3>
                            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                                {searchQuery
                                    ? `No items found for "${searchQuery}". Try a different search term.`
                                    : 'Add cooked meat items with recipes in Inventory → Item Master first.'}
                            </p>
                            {searchQuery && (
                                <button
                                    className="btn btn-secondary btn-sm"
                                    style={{ marginTop: 'var(--space-3)' }}
                                    onClick={() => setSearchQuery('')}
                                >
                                    Clear Search
                                </button>
                            )}
                        </div>
                    ) : (
                        <>
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
                                Showing {filteredItems.length} of {cookedItems.length} items
                            </p>
                            <div className="prod-item-select-grid">
                                {filteredItems.map(item => (
                                    <div
                                        key={item.id}
                                        className={`prod-item-card ${selectedItem?.id === item.id ? 'selected' : ''}`}
                                        onClick={() => handleSelectItem(item)}
                                    >
                                        <div className="item-icon">🍛</div>
                                        <div className="item-name">{item.name}</div>
                                        <div className="item-meta">
                                            {item.category_name} · {item.unit} · Recipe: {item.recipe?.base_batch_size}{item.recipe?.base_batch_unit || 'kg'} base
                                        </div>
                                        <div className="item-stock">
                                            Current Stock: {item.current_stock || 0} {item.unit}
                                        </div>
                                        <div className="item-meta" style={{ marginTop: 'var(--space-1)' }}>
                                            {item.recipe?.ingredients?.length || 0} ingredients · {item.allowed_production_quantities?.length || 0} qty options
                                        </div>
                                        {selectedItem?.id === item.id && (
                                            <span className="check-badge">✓</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </>
            )}

            {/* ═══ Step 2: Select Quantity ═══ */}
            {step === 2 && selectedItem && (
                <>
                    <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                            <span style={{ fontSize: 32 }}>🍛</span>
                            <div>
                                <h3 style={{ margin: 0, fontWeight: 700 }}>{selectedItem.name}</h3>
                                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                                    Base recipe: {selectedItem.recipe?.base_batch_size}{selectedItem.recipe?.base_batch_unit || 'kg'}
                                </p>
                            </div>
                        </div>

                        <h4 style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)', color: 'var(--color-text-secondary)' }}>
                            Select Production Quantity
                        </h4>

                        {allowedQtys.length > 0 ? (
                            <div className="prod-qty-dropdown">
                                {allowedQtys.map(qty => (
                                    <button
                                        key={qty}
                                        className={`prod-qty-btn ${selectedQty === qty ? 'active' : ''}`}
                                        onClick={() => handleQtySelect(qty)}
                                    >
                                        {qty} {selectedItem.unit || 'kg'}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div style={{
                                padding: 'var(--space-4)',
                                background: 'rgba(245, 158, 11, 0.08)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid rgba(245, 158, 11, 0.15)',
                                color: 'var(--color-text-secondary)',
                                fontSize: 'var(--text-sm)',
                            }}>
                                ⚠️ No production quantities configured for this item. Please edit the item in Inventory → Item Master and set allowed production quantities.
                            </div>
                        )}
                    </div>

                    {/* Recipe Preview with Stock Check */}
                    {selectedQty && (
                        <div className="recipe-preview">
                            <div className="recipe-preview-header">
                                <h3>📋 Recipe — Scaled to {selectedQty}{selectedItem.unit || 'kg'}</h3>
                                <span className="scale-badge">
                                    {selectedQty / selectedItem.recipe.base_batch_size}× base recipe
                                </span>
                            </div>

                            <div className="recipe-ingredient-header">
                                <span></span>
                                <span>Ingredient</span>
                                <span style={{ textAlign: 'right' }}>Required</span>
                                <span style={{ textAlign: 'right' }}>Available</span>
                                <span style={{ textAlign: 'center' }}>Status</span>
                            </div>

                            {checkingStock ? (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="recipe-ingredient-row">
                                        <div className="skeleton" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                                        <div className="skeleton skeleton-text" style={{ width: '60%' }} />
                                        <div className="skeleton skeleton-text" style={{ width: 60 }} />
                                        <div className="skeleton skeleton-text" style={{ width: 60 }} />
                                        <div className="skeleton skeleton-text" style={{ width: 60 }} />
                                    </div>
                                ))
                            ) : (
                                ingredientCheck.map(ing => (
                                    <div key={ing.item_id} className="recipe-ingredient-row">
                                        <span className="ing-icon">{getTypeIcon(ing.item_type)}</span>
                                        <span className="ing-name">
                                            {ing.item_name}
                                            {ing.missing && (
                                                <span style={{
                                                    marginLeft: 'var(--space-2)',
                                                    color: 'var(--color-danger)',
                                                    fontSize: 'var(--text-xs)',
                                                    fontWeight: 600
                                                }}>
                                                    (Deleted from master)
                                                </span>
                                            )}
                                        </span>
                                        <span className="ing-qty">
                                            {ing.scaled_sub_quantity} {ing.unit}
                                            {ing.unit !== ing.master_unit && ing.master_unit && (
                                                <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                                                    (= {ing.scaled_quantity} {ing.master_unit})
                                                </span>
                                            )}
                                        </span>
                                        <span className={`ing-available ${(!ing.sufficient || ing.missing) ? 'insufficient-value' : ''}`}>
                                            {ing.missing ? '---' : `${ing.available_stock.toFixed(2)} ${ing.master_unit}`}
                                        </span>
                                        <span className="ing-status">
                                            {ing.missing ? (
                                                <span className="insufficient" style={{ color: 'var(--color-danger)' }}>⚠ Missing</span>
                                            ) : ing.sufficient ? (
                                                <span className="sufficient">✓ OK</span>
                                            ) : (
                                                <span className="insufficient">⚠ Low</span>
                                            )}
                                        </span>
                                    </div>
                                ))
                            )}

                            {!checkingStock && ingredientCheck.length > 0 && (
                                <>
                                    {ingredientCheck.some(i => i.missing) && (
                                        <div style={{
                                            marginTop: 'var(--space-4)',
                                            padding: 'var(--space-4)',
                                            background: 'rgba(239, 68, 68, 0.08)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid rgba(239, 68, 68, 0.15)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: '#ef4444', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                                                <MdWarning /> BROKEN RECIPE DETECTED
                                            </div>
                                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
                                                One or more ingredients in <strong>{selectedItem.name}</strong>'s recipe have been permanently deleted from the Item Master.
                                                You cannot proceed with production until the recipe is updated.
                                            </p>
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => navigate('/inventory/items')}
                                                style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
                                            >
                                                Go to Item Master to Fix Recipe
                                            </button>
                                        </div>
                                    )}

                                    {!allSufficient && !ingredientCheck.some(i => i.missing) && (
                                        <div style={{
                                            marginTop: 'var(--space-4)',
                                            padding: 'var(--space-3)',
                                            background: 'rgba(239, 68, 68, 0.08)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid rgba(239, 68, 68, 0.15)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--space-2)',
                                            fontSize: 'var(--text-sm)',
                                            color: '#ef4444',
                                        }}>
                                            <MdWarning /> Insufficient stock. You cannot start production until all ingredients have enough stock available.
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between', marginTop: 'var(--space-4)' }}>
                        <button className="btn btn-secondary btn-md" onClick={() => setStep(1)}>
                            <MdArrowBack /> Back
                        </button>
                        {selectedQty && ingredientCheck.length > 0 && allSufficient && !ingredientCheck.some(i => i.missing) && (
                            <button className="btn btn-primary btn-md" onClick={() => setStep(3)}>
                                Review & Confirm <MdArrowForward />
                            </button>
                        )}
                    </div>
                </>
            )}

            {/* ═══ Step 3: Review & Start ═══ */}
            {step === 3 && selectedItem && selectedQty && (
                <>
                    <div className="card" style={{ padding: 'var(--space-6)' }}>
                        <h3 style={{ marginBottom: 'var(--space-4)', fontWeight: 700 }}>
                            <MdCheckCircle style={{ color: 'var(--color-primary)', marginRight: 'var(--space-2)' }} />
                            Confirm Production
                        </h3>

                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: 'var(--space-4)',
                            marginBottom: 'var(--space-5)',
                        }}>
                            <div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Item</div>
                                <div style={{ fontWeight: 700, fontSize: 'var(--text-md)' }}>🍛 {selectedItem.name}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Quantity</div>
                                <div style={{ fontWeight: 700, fontSize: 'var(--text-md)', color: 'var(--color-primary)' }}>
                                    {selectedQty} {selectedItem.unit || 'kg'}
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Scale Factor</div>
                                <div style={{ fontWeight: 600 }}>{(selectedQty / selectedItem.recipe.base_batch_size).toFixed(1)}× base recipe</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Ingredients</div>
                                <div style={{ fontWeight: 600 }}>{ingredientCheck.length} items</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Chef</div>
                                <div style={{ fontWeight: 600 }}>{user?.name || user?.email || 'Unknown'}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Stock Status</div>
                                <div style={{ fontWeight: 600, color: '#22c55e' }}>
                                    ✓ All ingredients available
                                </div>
                            </div>
                        </div>

                        {/* Summary of ingredients */}
                        <div style={{ marginBottom: 'var(--space-4)' }}>
                            <h4 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                                Ingredients to be deducted on start:
                            </h4>
                            {ingredientCheck.map(ing => (
                                <div key={ing.item_id} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    padding: 'var(--space-1) 0',
                                    fontSize: 'var(--text-sm)',
                                    borderBottom: '1px solid var(--color-divider)',
                                }}>
                                    <span>{getTypeIcon(ing.item_type)} {ing.item_name}</span>
                                    <span style={{ fontWeight: 600, textAlign: 'right' }}>
                                        {ing.scaled_sub_quantity} {ing.unit}
                                        {ing.unit !== ing.master_unit && ing.master_unit && (
                                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: 'var(--space-2)' }}>
                                                (= {ing.scaled_quantity} {ing.master_unit})
                                            </span>
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Notes */}
                        <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                            <label className="form-label">Notes (optional)</label>
                            <input
                                type="text"
                                className="form-input"
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder="e.g. Special batch for event"
                            />
                        </div>

                        <div style={{
                            padding: 'var(--space-3)',
                            background: 'rgba(239, 68, 68, 0.06)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid rgba(239, 68, 68, 0.15)',
                            fontSize: 'var(--text-sm)',
                            color: 'var(--color-text-secondary)',
                            marginBottom: 'var(--space-4)',
                        }}>
                            ⚠️ Ingredients will be <strong>deducted immediately</strong> when you click Start Production. If you cancel the production later, ingredients will be restored.
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between', marginTop: 'var(--space-4)' }}>
                        <button className="btn btn-secondary btn-md" onClick={() => setStep(2)} disabled={submitting}>
                            <MdArrowBack /> Back
                        </button>
                        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                            <button
                                className="btn btn-secondary btn-md"
                                onClick={generateBatchPdf}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                <MdPictureAsPdf /> Download PDF
                            </button>
                            <button
                                className="btn btn-primary btn-lg"
                                onClick={handleStartProduction}
                                disabled={submitting || !allSufficient}
                            >
                                {submitting ? 'Starting & Deducting...' : (
                                    <>
                                        <MdPlayArrow /> Start Production — {selectedQty}{selectedItem.unit || 'kg'} {selectedItem.name}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default StartProduction;
