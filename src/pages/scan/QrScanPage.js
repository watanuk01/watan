import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
    MdQrCodeScanner,
    MdLocalShipping,
    MdInventory2,
    MdContentCut,
    MdOutlineKitchen,
    MdStore,
    MdCheckCircle,
    MdSearch,
    MdAccountTree,
    MdFormatListBulleted,
    MdContentCopy,
    MdDone,
    MdHelpOutline,
    MdClose,
} from 'react-icons/md';
import { getBatchGenealogyTree, formatKg } from '../../services/butcheringService';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import './QrScanPage.css';

const safeDate = (val) => {
    if (!val) return '—';
    if (typeof val === 'string') return val.length > 10 ? new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : val;
    if (val instanceof Date) return val.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    if (val?.seconds) return new Date(val.seconds * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    try { const d = new Date(val); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return '—'; }
};

const STEP_CONFIG = {
    vendor: { icon: MdLocalShipping, color: '#3b82f6', label: '1. VENDOR DELIVERY' },
    parent: { icon: MdInventory2, color: '#f59e0b', label: '2. PARENT BATCH' },
    child: { icon: MdContentCut, color: '#c9a96e', label: '3. BUTCHER CUT' },
    butcher: { icon: MdContentCut, color: '#c9a96e', label: '3. BUTCHER BATCH' },
    production: { icon: MdOutlineKitchen, color: '#ec4899', label: '4. PRODUCTION RUN' },
    restaurant: { icon: MdStore, color: '#22c55e', label: '5. RESTAURANT ORDER' },
    delivery: { icon: MdCheckCircle, color: '#16a34a', label: '6. DELIVERED' },
};

/**
 * Recursive TreeNode component for rendering the visual genealogy tree.
 */
const TreeNode = ({ node, level = 0 }) => {
    const cfg = STEP_CONFIG[node.type] || STEP_CONFIG.parent;
    const IconComp = cfg.icon;
    const hasChildren = node.children?.length > 0;

    return (
        <div className="tree-branch-container">
            <div className="tree-node-wrapper">
                <div className={`scan-tree-node ${node.type}`} style={{ borderLeftColor: cfg.color }}>
                    <div className="scan-tree-node-icon" style={{ color: cfg.color }}>
                        <IconComp size={24} />
                    </div>
                    <div className="scan-tree-node-content">
                        <div className="scan-tree-node-tag" style={{ color: cfg.color }}>
                            {cfg.label}
                        </div>
                        <div className="scan-tree-node-title">{node.name}</div>
                        {node.batch_number && (
                            <div className="scan-tree-node-batch">
                                {node.batch_number}
                            </div>
                        )}
                        <div className="scan-tree-node-meta">
                            {(node.quantity !== undefined && node.quantity !== null && node.quantity !== '') && (
                                <span className="meta-pill qty">{formatKg(node.quantity)} kg</span>
                            )}
                            {node.date && (
                                <span className="meta-pill date">{safeDate(node.date)}</span>
                            )}
                        </div>
                        {node.info && (
                            <div className="scan-tree-node-info">{node.info}</div>
                        )}
                    </div>
                </div>
            </div>

            {hasChildren && (
                <>
                    <div className="scan-tree-connector" />
                    <div className="scan-tree-branches">
                        {node.children.map((child, i) => (
                            <TreeNode key={i} node={child} level={level + 1} />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

/**
 * Flatten a genealogy tree into a linear chain (timeline steps).
 */
const flattenToTimeline = (tree) => {
    const steps = [];
    const walk = (node) => {
        steps.push(node);
        if (node.children?.length) {
            walk(node.children[0]);
        }
    };
    if (tree) walk(tree);
    return steps;
};

/**
 * Build complete 5-point genealogy tree directly from order's stored dispatch_qr_items
 */
const buildTreeFromOrderData = (orderData, targetItemId) => {
    if (!orderData) return null;
    const qrItems = orderData.dispatch_qr_items || [];
    let qrItem = (targetItemId ? qrItems.find(q => q.item_id === targetItemId) : null) || qrItems[0];

    // Fallback: if no dispatch_qr_items, build from orderData.items (e.g. grocery or standard order)
    if (!qrItem && orderData.items?.length > 0) {
        const item = (targetItemId ? orderData.items.find(i => i.item_id === targetItemId || i.id === targetItemId) : null) || orderData.items[0];
        qrItem = {
            item_id: item.item_id || item.id,
            item_name: item.item_name || item.name,
            quantity: item.quantity,
            unit: item.unit || 'kg',
            item_type: item.item_type || 'grocery',
            category_name: item.category_name || '',
            batch_numbers: item.batch_number ? [item.batch_number] : [],
        };
    }

    if (!qrItem) return null;

    // Delivery confirmation node (if order delivered)
    const deliveryChildren = orderData.status === 'delivered' ? [{
        type: 'delivery',
        name: `Delivered to ${orderData.restaurant_name || 'Restaurant'}`,
        info: orderData.delivery_manager_name ? `Confirmed by: ${orderData.delivery_manager_name}` : 'Delivery confirmed',
        date: orderData.delivered_at,
        children: []
    }] : [];

    // Restaurant Order node
    const restaurantNode = {
        type: 'restaurant',
        name: orderData.restaurant_name || 'Restaurant',
        batch_number: orderData.order_number || '',
        quantity: qrItem.quantity || (orderData.items?.find(i => i.item_id === targetItemId) || {}).quantity,
        info: `Order #${orderData.order_number || '—'} — ${orderData.status === 'delivered' ? '✅ Delivered' : '📦 Ready for Pickup'}`,
        date: orderData.ready_at || orderData.created_at,
        children: deliveryChildren,
    };

    // If order has stored rich traceability array
    if (qrItem.traceability?.length) {
        const step = qrItem.traceability[0];

        // Production node
        const prodRunNo = step.production_number || step.source_production?.production_number;
        const prodBatchNo = step.production_batch || qrItem.batch_numbers?.[0];
        const prodName = step.production_item || step.product_name || qrItem.item_name;
        const prodQty = step.production_quantity;

        const prodNode = {
            type: 'production',
            name: prodName || 'Central Kitchen Production',
            batch_number: prodRunNo ? `Run ${prodRunNo}` : (prodBatchNo || ''),
            quantity: prodQty,
            info: prodRunNo ? `Production Run: ${prodRunNo}${step.chef_name ? ` by ${step.chef_name}` : ''}` : 'Central Kitchen Cooked Batch',
            date: step.production_date,
            children: [restaurantNode],
        };

        // Butcher Cut node
        const cutNode = step.child_batch?.batch_number ? {
            type: 'child',
            name: step.child_batch.item_name || 'CK Raw Meat Cut',
            batch_number: step.child_batch.batch_number,
            quantity: step.child_batch.weight_kg,
            info: 'Central Kitchen Butcher Cut',
            date: step.child_batch.date,
            children: [prodNode],
        } : prodNode;

        // Parent Carcass node
        const parentNode = step.parent_batch?.batch_number ? {
            type: 'parent',
            name: step.parent_batch.item_name || 'Whole Carcass',
            batch_number: step.parent_batch.batch_number,
            quantity: step.parent_batch.weight_kg,
            info: 'Butcher Parent Batch',
            date: step.parent_batch.date,
            children: [cutNode],
        } : cutNode;

        // Vendor node
        const vendorNode = {
            type: 'vendor',
            name: step.vendor || 'Meat Supplier',
            batch_number: step.po_number || '',
            info: 'Raw Meat Vendor Delivery',
            date: step.received_date,
            children: [parentNode],
        };

        return { tree: vendorNode, qrItem };
    }

    // Fallback if no deep traceability stored (grocery or unbatched item)
    const batchNos = qrItem.batch_numbers || [];
    const isGrocery = qrItem.item_type === 'grocery' || (!qrItem.batch_numbers?.length && !qrItem.traceability?.length);
    const itemNode = {
        type: isGrocery ? 'parent' : 'production',
        name: qrItem.item_name || 'Inventory Item',
        batch_number: batchNos[0] || 'Central Kitchen Stock',
        quantity: qrItem.quantity,
        info: isGrocery ? (qrItem.category_name ? `${qrItem.category_name} • Grocery Stock` : 'Grocery / Central Kitchen Stock') : 'Central Kitchen Production',
        date: orderData.created_at,
        children: [restaurantNode],
    };

    const vendorNode = {
        type: 'vendor',
        name: 'Watan Central Kitchen & Suppliers',
        batch_number: orderData.order_number || '',
        info: `Order Fulfillment #${orderData.order_number || ''}`,
        date: orderData.created_at,
        children: [itemNode],
    };

    return { tree: vendorNode, qrItem };
};

const QrScanPage = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const batchParam = searchParams.get('batch') || '';
    const orderParam = searchParams.get('order') || '';
    const itemParam = searchParams.get('item') || '';

    const [loading, setLoading] = useState(false);
    const [tree, setTree] = useState(null);
    const [timeline, setTimeline] = useState([]);
    const [orderInfo, setOrderInfo] = useState(null);
    const [selectedItemId, setSelectedItemId] = useState(itemParam);
    const [viewMode, setViewMode] = useState('tree'); // 'tree' or 'timeline'
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState(batchParam);
    const [copied, setCopied] = useState(false);
    const [showScanHelp, setShowScanHelp] = useState(false);
    const [zoom, setZoom] = useState(100);

    // Load batch traceability by batch/production/order query
    const loadTraceability = async (term) => {
        if (!term) return;
        setLoading(true);
        setError('');

        try {
            const genTree = await getBatchGenealogyTree(term);
            if (genTree) {
                setTree(genTree);
                setTimeline(flattenToTimeline(genTree));
            } else {
                setError(`No traceability record found for "${term}". Please verify the batch or order number.`);
            }
        } catch (err) {
            console.error('Traceability lookup failed:', err);
            setError('Failed to load traceability data. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Load order document and build tree immediately
    const loadOrderInfo = async (activeItemId) => {
        if (!orderParam) return;
        setLoading(true);
        setError('');

        try {
            const orderSnap = await getDoc(doc(db, 'orders', orderParam));
            if (orderSnap.exists()) {
                const data = orderSnap.data();
                setOrderInfo({ id: orderSnap.id, ...data });

                // Build tree directly from order data
                const result = buildTreeFromOrderData(data, activeItemId || itemParam);
                if (result?.tree) {
                    setTree(result.tree);
                    setTimeline(flattenToTimeline(result.tree));
                    if (!selectedItemId && result.qrItem?.item_id) {
                        setSelectedItemId(result.qrItem.item_id);
                    }
                }

                // If first batch has extra graph nodes, fetch in background
                const qrItem = result?.qrItem;
                const batchNo = qrItem?.batch_numbers?.[0];
                if (batchNo && !result?.qrItem?.traceability?.length) {
                    const fullerTree = await getBatchGenealogyTree(batchNo);
                    if (fullerTree) {
                        setTree(fullerTree);
                        setTimeline(flattenToTimeline(fullerTree));
                    }
                }
            } else {
                setError(`Order "${orderParam}" was not found.`);
            }
        } catch (err) {
            console.error('Order lookup failed:', err);
            setError('Could not load order details: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (orderParam) {
            loadOrderInfo(itemParam);
        } else if (batchParam) {
            loadTraceability(batchParam);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderParam, batchParam]);

    // Handle switching items within the same order
    const handleSwitchItem = (newId) => {
        setSelectedItemId(newId);
        if (orderInfo) {
            const result = buildTreeFromOrderData(orderInfo, newId);
            if (result?.tree) {
                setTree(result.tree);
                setTimeline(flattenToTimeline(result.tree));
            }
        }
    };

    // Copy link helper
    const handleCopyLink = () => {
        navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Current active item info
    const activeQrItem = useMemo(() => {
        if (!orderInfo?.dispatch_qr_items?.length) return null;
        return orderInfo.dispatch_qr_items.find(q => q.item_id === selectedItemId) || orderInfo.dispatch_qr_items[0];
    }, [orderInfo, selectedItemId]);

    return (
        <div className="scan-page">
            {/* Header */}
            <header className="scan-header">
                <div className="scan-header-inner">
                    <img src="/watan-logo.png" alt="Watan" className="scan-logo" />
                    <div className="scan-brand">
                        <div className="scan-badge-verified">✓ Halal Certified &amp; Tamper-Proof</div>
                        <h1>Batch Genealogy &amp; Traceability</h1>
                        <p>Complete farm-to-table lineage from FNA vendor through Central Kitchen to restaurant plate</p>
                    </div>
                </div>

                {/* Quick actions top bar */}
                <div className="scan-top-actions">
                    <button className="scan-chip-btn" onClick={handleCopyLink}>
                        {copied ? <MdDone color="#22c55e" /> : <MdContentCopy />}
                        {copied ? 'Link Copied!' : 'Copy Trace Link'}
                    </button>
                    <button className="scan-chip-btn" onClick={() => setShowScanHelp(true)}>
                        <MdHelpOutline /> Lens Scan Help
                    </button>
                    {batchParam && (
                        <button className="scan-chip-btn" onClick={() => navigate(`/butchering/traceability?batch=${encodeURIComponent(batchParam)}`)}>
                            <MdAccountTree /> Open in Butcher Traceability
                        </button>
                    )}
                </div>
            </header>

            {/* Scan Help Modal */}
            {showScanHelp && (
                <div className="scan-help-overlay" onClick={() => setShowScanHelp(false)}>
                    <div className="scan-help-card" onClick={e => e.stopPropagation()}>
                        <div className="scan-help-header">
                            <h3>📱 Instant Google Lens &amp; Camera Scanning</h3>
                            <button className="scan-help-close" onClick={() => setShowScanHelp(false)}>
                                <MdClose size={20} />
                            </button>
                        </div>
                        <div className="scan-help-body">
                            <div className="help-step">
                                <div className="help-num">1</div>
                                <div>
                                    <strong>Point Camera at QR Code</strong>
                                    <p>Open Google Lens or iPhone Camera. Hold it 10–15 inches away from the QR code.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <div className="help-num">2</div>
                                <div>
                                    <strong>Tap the Yellow/White Link Chip</strong>
                                    <p>Lens will instantly lock onto the link. Tap it to open this Genealogy Tree page directly.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <div className="help-num">3</div>
                                <div>
                                    <strong>On Computer Screen?</strong>
                                    <p>No phone needed! You can simply click any QR code or click <em>"View Genealogy Tree"</em> directly inside Watan to open this tree.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Order Context Banner */}
            {orderInfo && (
                <div className="scan-banner-wrapper">
                    <div className="scan-order-banner">
                        <div className="scan-order-top">
                            <div>
                                <span className="scan-order-tag">Order Dispatch</span>
                                <h2 className="scan-order-title">{orderInfo.order_number || orderInfo.id}</h2>
                            </div>
                            <div className={`scan-status-pill ${orderInfo.status}`}>
                                {orderInfo.status === 'delivered' ? '✅ Delivered' : '📦 Ready for Pickup'}
                            </div>
                        </div>

                        <div className="scan-order-grid">
                            <div className="scan-meta-box">
                                <div className="scan-meta-lbl">Destination Restaurant</div>
                                <div className="scan-meta-val">{orderInfo.restaurant_name || 'Restaurant'}</div>
                            </div>
                            {activeQrItem && (
                                <div className="scan-meta-box">
                                    <div className="scan-meta-lbl">Dispatched Product</div>
                                    <div className="scan-meta-val gold">
                                        {activeQrItem.item_name} ({formatKg(activeQrItem.quantity)} {activeQrItem.unit || 'kg'})
                                    </div>
                                </div>
                            )}
                            <div className="scan-meta-box">
                                <div className="scan-meta-lbl">Ready / Dispatch Date</div>
                                <div className="scan-meta-val">{safeDate(orderInfo.ready_at || orderInfo.created_at)}</div>
                            </div>
                        </div>

                        {/* Multiple Items Selector Tabs */}
                        {orderInfo.dispatch_qr_items && orderInfo.dispatch_qr_items.length > 1 && (
                            <div className="scan-items-tabs">
                                <span className="scan-tabs-lbl">Select Item:</span>
                                {orderInfo.dispatch_qr_items.map((item, idx) => (
                                    <button
                                        key={idx}
                                        className={`scan-item-tab ${selectedItemId === item.item_id ? 'active' : ''}`}
                                        onClick={() => handleSwitchItem(item.item_id)}
                                    >
                                        {item.item_name} ({formatKg(item.quantity)} {item.unit || 'kg'})
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Search Bar for manual lookup */}
            {!batchParam && !orderParam && (
                <div className="scan-search">
                    <div className="scan-search-wrap">
                        <MdSearch className="scan-search-icon" />
                        <input
                            type="text"
                            placeholder="Enter batch number (e.g. BT-RM-...), production number, or order ID..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && loadTraceability(searchTerm)}
                        />
                    </div>
                    <button className="scan-search-btn" onClick={() => loadTraceability(searchTerm)} disabled={loading}>
                        {loading ? 'Searching...' : 'Trace Lineage'}
                    </button>
                </div>
            )}

            {/* View Mode Toggle: Tree vs Timeline */}
            {(tree || timeline.length > 0) && (
                <div className="scan-view-toggle-bar">
                    <div className="scan-view-toggle">
                        <button
                            className={`toggle-btn ${viewMode === 'tree' ? 'active' : ''}`}
                            onClick={() => setViewMode('tree')}
                        >
                            <MdAccountTree size={18} /> Interactive Genealogy Tree
                        </button>
                        <button
                            className={`toggle-btn ${viewMode === 'timeline' ? 'active' : ''}`}
                            onClick={() => setViewMode('timeline')}
                        >
                            <MdFormatListBulleted size={18} /> Supply Chain Timeline
                        </button>
                    </div>
                    {viewMode === 'tree' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255, 255, 255, 0.05)', padding: '2px 8px', borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                <button
                                    type="button"
                                    onClick={() => setZoom(z => Math.max(50, z - 15))}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 8px', fontWeight: 700, fontSize: 13, color: '#f3f4f6' }}
                                    title="Zoom Out"
                                >−</button>
                                <span style={{ fontSize: 12, fontWeight: 600, minWidth: 40, textAlign: 'center', color: '#f3f4f6' }}>{zoom}%</span>
                                <button
                                    type="button"
                                    onClick={() => setZoom(z => Math.min(150, z + 15))}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 8px', fontWeight: 700, fontSize: 13, color: '#f3f4f6' }}
                                    title="Zoom In"
                                >+</button>
                                <button
                                    type="button"
                                    onClick={() => setZoom(100)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', fontSize: 11, color: '#9ca3af' }}
                                    title="Reset to 100%"
                                >Reset</button>
                                <button
                                    type="button"
                                    onClick={() => setZoom(75)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', fontSize: 11, color: '#c9a96e', fontWeight: 600 }}
                                    title="Fit wide tree to screen"
                                >Fit</button>
                            </div>
                            <div className="scan-mobile-hint" style={{ margin: 0 }}>
                                <span>↔ Scroll horizontally to view full tree branches</span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="scan-loading">
                    <div className="scan-spinner" />
                    <p>Fetching full vendor-to-table batch lineage...</p>
                </div>
            )}

            {/* Error */}
            {error && !loading && (
                <div className="scan-error">
                    <MdQrCodeScanner size={56} style={{ color: '#ef4444' }} />
                    <h3>Traceability Record Not Found</h3>
                    <p>{error}</p>
                    <div style={{ marginTop: 20 }}>
                        <button className="scan-search-btn" onClick={() => navigate('/butchering/traceability')}>
                            Go to Central Kitchen Traceability
                        </button>
                    </div>
                </div>
            )}

            {/* ─── Tree View ─── */}
            {!loading && viewMode === 'tree' && tree && (
                <div className="scan-tree-wrapper">
                    <div
                        className="scan-tree-container"
                        style={{
                            transform: zoom !== 100 ? `scale(${zoom / 100})` : 'none',
                            transformOrigin: 'top center',
                            transition: 'transform 0.2s ease',
                        }}
                    >
                        <TreeNode node={tree} />
                    </div>
                </div>
            )}

            {/* ─── Timeline View ─── */}
            {!loading && viewMode === 'timeline' && timeline.length > 0 && (
                <div className="scan-timeline">
                    {timeline.map((step, i) => {
                        const cfg = STEP_CONFIG[step.type] || STEP_CONFIG.parent;
                        const IconComp = cfg.icon;
                        const isLast = i === timeline.length - 1;

                        return (
                            <div key={i} className={`scan-step ${isLast ? 'scan-step-last' : ''}`}>
                                <div className="scan-step-line">
                                    <div className="scan-step-dot" style={{ background: cfg.color }}>
                                        <IconComp size={18} color="#fff" />
                                    </div>
                                    {!isLast && <div className="scan-step-connector" />}
                                </div>
                                <div className="scan-step-content">
                                    <div className="scan-step-tag" style={{ color: cfg.color }}>{cfg.label}</div>
                                    <div className="scan-step-title">{step.name}</div>
                                    {step.batch_number && (
                                        <div className="scan-step-batch">{step.batch_number}</div>
                                    )}
                                    <div className="scan-step-meta">
                                        {(step.quantity !== undefined && step.quantity !== null && step.quantity !== '') && <span>{formatKg(step.quantity)} kg</span>}
                                        {step.date && <span>{safeDate(step.date)}</span>}
                                    </div>
                                    {step.info && <div className="scan-step-info">{step.info}</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Verified Footer */}
            <footer className="scan-footer">
                <div className="scan-footer-badge">
                    <MdCheckCircle size={20} color="#22c55e" />
                    <span>Watan Central Kitchen Certified Batch Verification</span>
                </div>
                <p>This batch data is recorded in the Watan central database and validated against HACCP standards.</p>
                <p className="scan-copyright">© {new Date().getFullYear()} Watan Central Kitchen. All rights reserved.</p>
            </footer>
        </div>
    );
};

export default QrScanPage;
