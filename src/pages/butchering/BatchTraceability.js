import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
    MdQrCodeScanner,
    MdSearch,
    MdPrint,
    MdArrowBack,
    MdStore,
    MdOutlineKitchen,
    MdLocalShipping,
    MdInventory2,
    MdContentCut,
    MdRefresh,
} from 'react-icons/md';
import { getBatchGenealogyTree } from '../../services/butcheringService';
import QrCodeSvg from '../../components/ui/QrCodeSvg';
import toast from 'react-hot-toast';
import './ButcheringModule.css';

const safeDate = (val) => {
    if (!val) return '—';
    if (typeof val === 'string') return val;
    if (val instanceof Date) return val.toLocaleDateString('en-GB');
    if (val?.seconds) return new Date(val.seconds * 1000).toLocaleDateString('en-GB');
    try { const d = new Date(val); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB'); } catch { return '—'; }
};

const NODE_CONFIG = {
    vendor: { color: 'var(--color-info)', icon: MdLocalShipping },
    parent: { color: 'var(--color-warning)', icon: MdInventory2 },
    butcher: { color: 'var(--color-primary)', icon: MdContentCut },
    child: { color: 'var(--color-success)', icon: MdQrCodeScanner },
    production: { color: '#ec4899', icon: MdOutlineKitchen },
    restaurant: { color: 'var(--color-success)', icon: MdStore },
};

const TreeNode = ({ node, level = 0 }) => {
    const cfg = NODE_CONFIG[node.type] || NODE_CONFIG.child;
    const IconComp = cfg.icon;
    const hasChildren = node.children?.length > 0;

    return (
        <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div className={`tree-node ${node.type}`}>
                    <IconComp className="tree-node-icon" />
                    <div>
                        <div className="tree-node-tag">{(node.type || 'BATCH').toUpperCase()}</div>
                        <div className="tree-node-title">{node.name}</div>
                        {node.batch_number && (
                            <span className="batch-code" style={{ marginTop: 3, display: 'inline-block' }}>{node.batch_number}</span>
                        )}
                        {node.quantity && <div className="tree-node-meta">{node.quantity} kg</div>}
                        {node.date && <div className="tree-node-meta" style={{ color: 'var(--color-text-muted)' }}>{safeDate(node.date)}</div>}
                        {node.info && <div className="tree-node-meta">{node.info}</div>}
                    </div>
                </div>
            </div>

            {hasChildren && (
                <>
                    <div className="tree-connector" />
                    <div className="tree-branches">
                        {node.children.map((child, i) => (
                            <TreeNode key={i} node={child} level={level + 1} />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

const BatchTraceability = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const initialBatch = searchParams.get('batch') || '';

    const [searchTerm, setSearchTerm] = useState(initialBatch);
    const [loading, setLoading] = useState(false);
    const [genealogy, setGenealogy] = useState(null);
    const [printBatch, setPrintBatch] = useState(null);

    const search = async (term) => {
        const q = term || searchTerm;
        if (!q) return;
        setLoading(true);
        setGenealogy(null);
        try {
            const tree = await getBatchGenealogyTree(q.trim());
            if (!tree) {
                toast.error(`No batch found matching "${q}"`);
            } else {
                setGenealogy(tree);
            }
        } catch (err) {
            toast.error('Search failed: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (initialBatch) search(initialBatch);
    }, []);

    const flatBatches = (tree) => {
        const out = [];
        const walk = (n) => { out.push(n); n.children?.forEach(walk); };
        if (tree) walk(tree);
        return out;
    };

    // Build genealogy text from tree for a specific node's QR code
    const buildGenealogyQrText = (node, tree) => {
        // Walk the tree to find the ancestor chain for this node
        const lines = [
            `WATAN CENTRAL KITCHEN`,
            `--- BATCH TRACEABILITY ---`,
            `Batch: ${node.batch_number}`,
            `Product: ${node.name}`,
        ];
        if (node.quantity) lines.push(`Weight: ${node.quantity} kg`);
        if (node.date) lines.push(`Date: ${safeDate(node.date)}`);

        lines.push(``);
        lines.push(`--- GENEALOGY FLOW ---`);

        // Walk tree top-down to build the chain
        const chain = [];
        const findPath = (n, target, path) => {
            path.push(n);
            if (n.batch_number === target) return true;
            for (const child of (n.children || [])) {
                if (findPath(child, target, path)) return true;
            }
            path.pop();
            return false;
        };
        findPath(tree, node.batch_number, chain);

        chain.forEach((step, i) => {
            const prefix = i === 0 ? '' : '  > ';
            lines.push(`${prefix}${(step.type || 'batch').toUpperCase()}: ${step.name}`);
            if (step.batch_number) lines.push(`  Batch: ${step.batch_number}`);
            if (step.quantity) lines.push(`  Weight: ${step.quantity} kg`);
            if (step.info) lines.push(`  ${step.info}`);
        });

        return lines.join('\n');
    };

    return (
        <div className="butcher-page">
            <div className="butcher-page-header">
                <div>
                    <button className="btn-back" onClick={() => navigate('/butchering/dashboard')}>
                        <MdArrowBack /> Back to Dashboard
                    </button>
                    <h1 className="butcher-page-title" style={{ marginTop: 6 }}>
                        <MdQrCodeScanner className="title-icon" /> Batch Traceability &amp; QR Codes
                    </h1>
                    <p className="butcher-page-subtitle">
                        Search any batch number to see its full vendor → kitchen → restaurant genealogy tree
                    </p>
                </div>
                {genealogy && (
                    <div className="butcher-header-actions">
                        <button className="btn btn-secondary btn-md" onClick={() => window.print()}>
                            <MdPrint /> Print Labels
                        </button>
                    </div>
                )}
            </div>

            {/* Search */}
            <div className="butcher-panel" style={{ marginBottom: 20 }}>
                <div className="trace-search-row">
                    <div className="trace-search-wrap">
                        <MdSearch className="search-icon" />
                        <input
                            type="text"
                            placeholder="Enter batch number e.g. WL-260718-001..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && search()}
                        />
                    </div>
                    <button className="btn btn-primary btn-md" onClick={() => search()} disabled={loading}>
                        <MdSearch /> {loading ? 'Searching...' : 'Trace Batch'}
                    </button>
                    {genealogy && (
                        <button className="btn btn-secondary btn-md" onClick={() => { setGenealogy(null); setSearchTerm(''); }}>
                            <MdRefresh /> Clear
                        </button>
                    )}
                </div>
            </div>

            {/* Genealogy Tree */}
            {loading ? (
                <div className="butcher-loading">Building genealogy tree...</div>
            ) : genealogy ? (
                <>
                    <div className="butcher-panel" style={{ overflowX: 'auto' }}>
                        <div className="genealogy-wrapper">
                            <h3 className="genealogy-title">
                                <MdQrCodeScanner color="var(--color-primary)" />
                                Batch Genealogy Tree: <span style={{ color: 'var(--color-primary)' }}>{genealogy.batch_number || searchTerm}</span>
                            </h3>
                            <TreeNode node={genealogy} />
                        </div>
                    </div>

                    {/* QR Print Labels Grid */}
                    <div className="butcher-panel">
                        <h3 className="butcher-panel-title"><MdPrint /> QR Print Labels</h3>
                        <div className="qr-print-grid">
                            {flatBatches(genealogy).filter(n => n.batch_number).map((n, i) => (
                                <div key={i} className="qr-label-box">
                                    <div className="qr-label-header">WATAN CENTRAL KITCHEN</div>
                                    <div className="qr-label-body">
                                        <QrCodeSvg value={buildGenealogyQrText(n, genealogy)} size={80} />
                                        <div className="qr-label-info">
                                            <div className="qr-label-product">{n.name}</div>
                                            <div>Batch: <strong>{n.batch_number}</strong></div>
                                            {n.quantity && <div>Weight: <strong>{n.quantity} kg</strong></div>}
                                            {n.date && <div>Date: <strong>{safeDate(n.date)}</strong></div>}
                                            {n.info && <div><small>{n.info}</small></div>}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            ) : (
                <div className="butcher-panel">
                    <div className="butcher-empty">
                        <MdQrCodeScanner style={{ fontSize: 56, color: 'var(--color-border-strong)', marginBottom: 12 }} />
                        <p style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            Search a Batch to View Its Genealogy
                        </p>
                        <p>Enter any batch number above (parent or child) to see the full trace from vendor delivery to restaurant plate.</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BatchTraceability;
