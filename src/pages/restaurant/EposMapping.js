/**
 * EPOS Item Mapping — Restaurant page for mapping EPOS vendor items to our menu items.
 *
 * Shows:
 *   1. Unmapped items received from EPOS webhooks (need admin attention)
 *   2. Existing mappings (EPOS item → our menu item + portion)
 *   3. Ability to create/edit/delete mappings
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
    getEposItemMappings, saveEposItemMapping, deleteEposItemMapping,
    getUnmappedEposItems, removeUnmappedItem, getEposEventStats,
    reprocessAfterMapping,
} from '../../services/eposService';
import { getMenuItems } from '../../services/menuService';
import {
    MdLink, MdLinkOff, MdRefresh, MdSearch, MdClose, MdCheckCircle,
    MdWarning, MdDelete, MdSave, MdAdd, MdSync,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import './Restaurant.css';

const EposMapping = () => {
    const { currentUser } = useAuth();
    const restaurantId = currentUser?.uid;

    const [mappings, setMappings] = useState([]);
    const [unmappedItems, setUnmappedItems] = useState([]);
    const [menuItems, setMenuItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(null);
    const [stats, setStats] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Mapping form state (for unmapped items)
    const [mappingForm, setMappingForm] = useState({});

    const fetchData = useCallback(async () => {
        if (!restaurantId) return;
        setLoading(true);
        try {
            const [mapData, unmapped, menu, eventStats] = await Promise.all([
                getEposItemMappings(restaurantId),
                getUnmappedEposItems(restaurantId),
                getMenuItems(restaurantId),
                getEposEventStats(restaurantId),
            ]);
            setMappings(mapData);
            setUnmappedItems(unmapped);
            setMenuItems(menu);
            setStats(eventStats);
        } catch (err) {
            toast.error('Failed to load EPOS data');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [restaurantId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ── Handle mapping an unmapped item ──
    const handleMapItem = async (unmapped) => {
        const form = mappingForm[unmapped.epos_item_id];
        if (!form?.menuItemId) {
            toast.error('Please select a menu item to map to');
            return;
        }

        const selectedMenu = menuItems.find(m => m.id === form.menuItemId);
        if (!selectedMenu) {
            toast.error('Selected menu item not found');
            return;
        }

        const selectedPortion = form.portionId
            ? selectedMenu.portions?.find(p => p.id === form.portionId)
            : selectedMenu.portions?.[0];

        setSaving(unmapped.epos_item_id);
        try {
            await saveEposItemMapping({
                restaurant_id: restaurantId,
                epos_item_id: unmapped.epos_item_id,
                epos_item_name: unmapped.epos_item_name,
                mapped_menu_item_id: selectedMenu.id,
                mapped_menu_item_name: selectedMenu.name,
                mapped_portion_id: selectedPortion?.id || '',
                mapped_portion_name: selectedPortion?.name || '',
                is_active: true,
            });

            // Remove from unmapped list
            await removeUnmappedItem(unmapped.id);

            // Reprocess past orders that had this item as unmapped
            // This deducts stock and updates the event records retroactively
            const reprocessResult = await reprocessAfterMapping(restaurantId, unmapped.epos_item_id);
            if (reprocessResult?.events_updated > 0) {
                toast.success(
                    `"${unmapped.epos_item_name}" mapped to "${selectedMenu.name}". ${reprocessResult.events_updated} past order(s) updated.`,
                    { duration: 5000 }
                );
            } else {
                toast.success(`"${unmapped.epos_item_name}" mapped to "${selectedMenu.name}"`);
            }

            fetchData();
        } catch (err) {
            toast.error('Failed to save mapping');
            console.error(err);
        } finally {
            setSaving(null);
        }
    };

    // ── Delete a mapping ──
    const handleDeleteMapping = async (mapping) => {
        if (!window.confirm(`Remove mapping for "${mapping.epos_item_name}"?`)) return;
        try {
            await deleteEposItemMapping(mapping.id);
            toast.success('Mapping removed');
            fetchData();
        } catch (err) {
            toast.error('Failed to delete mapping');
        }
    };

    // ── Filter ──
    const filteredMappings = mappings.filter(m => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return m.epos_item_name?.toLowerCase().includes(q)
            || m.mapped_menu_item_name?.toLowerCase().includes(q);
    });

    const filteredUnmapped = unmappedItems.filter(u => {
        if (!searchQuery.trim()) return true;
        return u.epos_item_name?.toLowerCase().includes(searchQuery.toLowerCase());
    });

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <MdSync style={{ marginRight: 'var(--space-2)' }} />
                        EPOS Item Mapping
                    </h1>
                    <p className="page-subtitle">
                        Map EPOS vendor items to your menu items for automatic inventory deduction.
                        {stats && ` · ${stats.total} events received · ${stats.processed} processed`}
                    </p>
                </div>
                <button className="btn-refresh" onClick={fetchData} title="Refresh"><MdRefresh /></button>
            </div>

            {/* Stats Banner */}
            {unmappedItems.length > 0 && (
                <div style={{
                    padding: '14px 20px', marginBottom: 'var(--space-5)',
                    background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)',
                    borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: 12,
                }}>
                    <MdWarning style={{ fontSize: 22, color: '#f59e0b', flexShrink: 0 }} />
                    <div>
                        <strong style={{ color: '#d97706' }}>{unmappedItems.length} unmapped item(s)</strong>
                        <span style={{ color: 'var(--color-text-muted)', marginLeft: 8, fontSize: 13 }}>
                            These items were received from EPOS but have no menu mapping. Inventory was NOT deducted.
                        </span>
                    </div>
                </div>
            )}

            {/* Search */}
            <div className="search-bar" style={{ marginBottom: 'var(--space-5)' }}>
                <MdSearch className="search-icon" />
                <input
                    className="search-input"
                    placeholder="Search items..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                    <button className="search-clear" onClick={() => setSearchQuery('')}>
                        <MdClose />
                    </button>
                )}
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
                    Loading...
                </div>
            ) : (
                <>
                    {/* ══ UNMAPPED ITEMS ══ */}
                    {filteredUnmapped.length > 0 && (
                        <div style={{ marginBottom: 'var(--space-6)' }}>
                            <h2 style={{
                                fontSize: 'var(--text-base)', fontWeight: 700,
                                color: '#d97706', marginBottom: 'var(--space-3)',
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                                <MdLinkOff /> Unmapped EPOS Items
                            </h2>
                            <div className="card">
                                <div className="data-table-wrapper">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>EPOS Item ID</th>
                                                <th>EPOS Item Name</th>
                                                <th>Portion</th>
                                                <th>Seen</th>
                                                <th>Map To Menu Item</th>
                                                <th>Portion</th>
                                                <th>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredUnmapped.map(u => {
                                                const form = mappingForm[u.epos_item_id] || {};
                                                const selectedMenu = menuItems.find(m => m.id === form.menuItemId);
                                                return (
                                                    <tr key={u.id}>
                                                        <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--color-text-muted)' }}>
                                                            {u.epos_item_id}
                                                        </td>
                                                        <td style={{ fontWeight: 600 }}>{u.epos_item_name}</td>
                                                        <td>{u.portion || '—'}</td>
                                                        <td>
                                                            <span className="badge badge-neutral">{u.occurrence_count || 1}×</span>
                                                        </td>
                                                        <td>
                                                            <select
                                                                className="settings-field-input"
                                                                style={{ minWidth: 180, fontSize: 12 }}
                                                                value={form.menuItemId || ''}
                                                                onChange={e => setMappingForm(prev => ({
                                                                    ...prev,
                                                                    [u.epos_item_id]: { ...prev[u.epos_item_id], menuItemId: e.target.value, portionId: '' },
                                                                }))}
                                                            >
                                                                <option value="">— Select Menu Item —</option>
                                                                {menuItems.filter(m => m.is_active !== false).map(m => (
                                                                    <option key={m.id} value={m.id}>{m.name}</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td>
                                                            {selectedMenu?.portions?.length > 1 ? (
                                                                <select
                                                                    className="settings-field-input"
                                                                    style={{ minWidth: 100, fontSize: 12 }}
                                                                    value={form.portionId || ''}
                                                                    onChange={e => setMappingForm(prev => ({
                                                                        ...prev,
                                                                        [u.epos_item_id]: { ...prev[u.epos_item_id], portionId: e.target.value },
                                                                    }))}
                                                                >
                                                                    {selectedMenu.portions.map(p => (
                                                                        <option key={p.id} value={p.id}>{p.name}</option>
                                                                    ))}
                                                                </select>
                                                            ) : (
                                                                <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                                                                    {selectedMenu?.portions?.[0]?.name || '—'}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <button
                                                                className="btn btn-primary btn-sm"
                                                                onClick={() => handleMapItem(u)}
                                                                disabled={!form.menuItemId || saving === u.epos_item_id}
                                                            >
                                                                <MdLink size={14} /> {saving === u.epos_item_id ? 'Saving...' : 'Map'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ══ EXISTING MAPPINGS ══ */}
                    <div>
                        <h2 style={{
                            fontSize: 'var(--text-base)', fontWeight: 700,
                            color: 'var(--color-text-primary)', marginBottom: 'var(--space-3)',
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                            <MdLink /> Active Mappings
                            <span className="badge badge-neutral" style={{ fontWeight: 500 }}>{filteredMappings.length}</span>
                        </h2>

                        {filteredMappings.length === 0 ? (
                            <div className="card" style={{
                                padding: 'var(--space-8)', textAlign: 'center',
                                color: 'var(--color-text-muted)',
                            }}>
                                <MdLink style={{ fontSize: 36, display: 'block', margin: '0 auto var(--space-2)' }} />
                                <p>No mappings yet. Mappings will appear here when EPOS items are linked to your menu items.</p>
                                {unmappedItems.length > 0 && (
                                    <p style={{ color: '#d97706', marginTop: 8 }}>
                                        ↑ You have {unmappedItems.length} unmapped item(s) above that need attention.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="card">
                                <div className="data-table-wrapper">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>EPOS Item</th>
                                                <th>→</th>
                                                <th>Menu Item</th>
                                                <th>Portion</th>
                                                <th>Status</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredMappings.map(m => (
                                                <tr key={m.id}>
                                                    <td>
                                                        <div style={{ fontWeight: 600 }}>{m.epos_item_name}</div>
                                                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                                                            ID: {m.epos_item_id}
                                                        </div>
                                                    </td>
                                                    <td style={{ fontSize: 16, color: 'var(--color-primary)' }}>→</td>
                                                    <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                                                        {m.mapped_menu_item_name}
                                                    </td>
                                                    <td>{m.mapped_portion_name || '—'}</td>
                                                    <td>
                                                        {m.is_active !== false ? (
                                                            <span className="badge badge-success"><MdCheckCircle /> Active</span>
                                                        ) : (
                                                            <span className="badge badge-neutral">Inactive</span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <button
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => handleDeleteMapping(m)}
                                                            style={{ color: 'var(--color-danger)' }}
                                                        >
                                                            <MdDelete size={14} /> Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default EposMapping;
