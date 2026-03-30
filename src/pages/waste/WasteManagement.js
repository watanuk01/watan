import React, { useState, useEffect, useCallback } from 'react';
import { MdDelete, MdAdd, MdSearch, MdRefresh, MdVisibility, MdTableChart, MdBarChart } from 'react-icons/md';
import { useAuth } from '../../contexts/AuthContext';
import {
    getWasteEvents,
    getWasteStats,
    getWasteTrend,
    detectExpiredBatches,
    getCategoryInfo,
    WASTE_CATEGORIES,
} from '../../services/wasteService';
import { getUsersByRole } from '../../services/userService';
import LogWasteModal from './LogWasteModal';
import WasteDetailModal from './WasteDetailModal';
import './Waste.css';
import toast from 'react-hot-toast';
import {
    PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, LineChart, Line,
} from 'recharts';

const formatDate = (d) => {
    if (!d) return '—';
    const date = d instanceof Date ? d : new Date(d);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const formatCurrency = (amt) => `£${(amt || 0).toFixed(2)}`;

// ─── Chart Colors ───
const CHART_COLORS = ['#ef4444', '#f59e0b', '#f97316', '#8b5cf6', '#3b82f6', '#6b7280', '#22c55e', '#14b8a6'];

const WasteManagement = () => {
    const { userProfile, isAdmin, isCKStaff, isRestaurantManager } = useAuth();
    const isAdminUser = isAdmin() || isCKStaff();
    const isRestaurant = isRestaurantManager();

    // State
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showLogModal, setShowLogModal] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [stats, setStats] = useState(null);
    const [trendData, setTrendData] = useState([]);
    const [restaurants, setRestaurants] = useState([]);
    const [activeView, setActiveView] = useState('table'); // 'table' | 'analytics'

    // Filters
    const [filters, setFilters] = useState({
        location: '',
        category: '',
        dateFrom: '',
        dateTo: '',
        search: '',
    });

    // Fetch waste events
    const fetchEvents = useCallback(async () => {
        setLoading(true);
        try {
            const queryFilters = {};

            if (isRestaurant) {
                queryFilters.location_id = userProfile?.id;
            } else if (filters.location === 'central_kitchen') {
                queryFilters.location_type = 'central_kitchen';
            } else if (filters.location && filters.location !== '') {
                queryFilters.location_id = filters.location;
            }

            if (filters.category) queryFilters.category = filters.category;
            if (filters.dateFrom) queryFilters.dateFrom = filters.dateFrom;
            if (filters.dateTo) queryFilters.dateTo = filters.dateTo;

            const data = await getWasteEvents(queryFilters);
            setEvents(data);

            if (isAdminUser) {
                setStats(getWasteStats(data));
                setTrendData(getWasteTrend(data));
            }
        } catch (err) {
            console.error('Failed to fetch waste events:', err);
            toast.error('Failed to load waste data');
        } finally {
            setLoading(false);
        }
    }, [filters.location, filters.category, filters.dateFrom, filters.dateTo, isRestaurant, isAdminUser, userProfile?.id]);

    useEffect(() => { fetchEvents(); }, [fetchEvents]);

    // Fetch restaurants list for admin filter
    useEffect(() => {
        if (!isAdminUser) return;
        const fetchRestaurants = async () => {
            try {
                const managers = await getUsersByRole('restaurant_manager');
                const nonManaged = await getUsersByRole('restaurant_manager_non_managed');
                const all = [...managers, ...nonManaged].map(u => ({
                    id: u.id,
                    name: u.restaurant_name || u.name || u.email,
                }));
                setRestaurants(all);
            } catch (err) {
                console.error('Failed to load restaurants:', err);
            }
        };
        fetchRestaurants();
    }, [isAdminUser]);

    // Auto-detect expired batches on first load (admin only)
    useEffect(() => {
        if (!isAdminUser || !userProfile) return;
        const runAutoDetect = async () => {
            try {
                const count = await detectExpiredBatches({
                    uid: userProfile.id,
                    name: userProfile.name || userProfile.email,
                    email: userProfile.email,
                });
                if (count > 0) {
                    toast.success(`🤖 ${count} expired batch${count > 1 ? 'es' : ''} auto-detected and logged as waste`);
                    fetchEvents();
                }
            } catch (err) {
                console.error('Auto-expiry detection failed:', err);
            }
        };
        runAutoDetect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdminUser, userProfile?.id]);

    // Filtered events (client-side search)
    const filteredEvents = events.filter(e => {
        if (!filters.search) return true;
        const q = filters.search.toLowerCase();
        return (
            (e.item_name || '').toLowerCase().includes(q) ||
            (e.location_name || '').toLowerCase().includes(q) ||
            (e.notes || '').toLowerCase().includes(q) ||
            (e.submitted_by?.name || '').toLowerCase().includes(q)
        );
    });

    // ─── Prepare chart data ───
    const categoryChartData = stats ? WASTE_CATEGORIES
        .filter(c => (stats.byCategory[c.value] || 0) > 0)
        .map(c => ({ name: c.label, value: parseFloat((stats.byCategory[c.value] || 0).toFixed(2)), icon: c.icon, color: c.color }))
        : [];

    const locationChartData = stats ? Object.entries(stats.byLocation)
        .map(([name, value]) => ({ name: name.length > 15 ? name.substring(0, 15) + '…' : name, value: parseFloat(value.toFixed(2)), fullName: name }))
        .sort((a, b) => b.value - a.value)
        : [];

    const topItemsData = stats ? stats.topItems.map(it => ({
        name: it.name.length > 20 ? it.name.substring(0, 20) + '…' : it.name,
        value: parseFloat(it.value.toFixed(2)),
        qty: it.qty,
        count: it.count,
        fullName: it.name,
    })) : [];

    // Custom tooltip
    const CustomTooltip = ({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        return (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: 'var(--shadow-lg)' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{label || payload[0]?.name}</div>
                {payload.map((p, i) => (
                    <div key={i} style={{ color: p.color }}>
                        {p.dataKey === 'value' ? formatCurrency(p.value) : `${p.value}`}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="waste-page">
            {/* Header */}
            <div className="waste-header">
                <h1>
                    <MdDelete style={{ color: '#ef4444' }} />
                    Waste Management
                </h1>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {isAdminUser && (
                        <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
                            <button
                                className={`btn btn-sm ${activeView === 'table' ? 'btn-primary' : 'btn-ghost'}`}
                                onClick={() => setActiveView('table')}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 0, padding: '6px 12px' }}>
                                <MdTableChart /> Table
                            </button>
                            <button
                                className={`btn btn-sm ${activeView === 'analytics' ? 'btn-primary' : 'btn-ghost'}`}
                                onClick={() => setActiveView('analytics')}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 0, padding: '6px 12px' }}>
                                <MdBarChart /> Analytics
                            </button>
                        </div>
                    )}
                    <button className="btn-refresh" onClick={fetchEvents}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MdRefresh /></button>
                    <button className="btn btn-primary btn-md" onClick={() => setShowLogModal(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MdAdd /> Log Waste Event
                    </button>
                </div>
            </div>

            {/* Admin Stats */}
            {isAdminUser && stats && (
                <div className="waste-stats">
                    <div className="waste-stat-card">
                        <div className="stat-label">Today</div>
                        <div className="stat-value">{formatCurrency(stats.today.value)}</div>
                        <div className="stat-count">{stats.today.count} events</div>
                    </div>
                    <div className="waste-stat-card">
                        <div className="stat-label">This Week</div>
                        <div className="stat-value">{formatCurrency(stats.week.value)}</div>
                        <div className="stat-count">{stats.week.count} events</div>
                    </div>
                    <div className="waste-stat-card">
                        <div className="stat-label">This Month</div>
                        <div className="stat-value">{formatCurrency(stats.month.value)}</div>
                        <div className="stat-count">{stats.month.count} events</div>
                    </div>
                    <div className="waste-stat-card highlight">
                        <div className="stat-label">All Time</div>
                        <div className="stat-value">{formatCurrency(stats.total.value)}</div>
                        <div className="stat-count">{stats.total.count} total events</div>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="waste-filters">
                {isAdminUser && (
                    <select value={filters.location} onChange={e => setFilters(p => ({ ...p, location: e.target.value }))}>
                        <option value="">All Locations</option>
                        <option value="central_kitchen">Central Kitchen</option>
                        {restaurants.map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                    </select>
                )}
                <select value={filters.category} onChange={e => setFilters(p => ({ ...p, category: e.target.value }))}>
                    <option value="">All Categories</option>
                    {WASTE_CATEGORIES.map(c => (
                        <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                    ))}
                </select>
                <input type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} title="From date" />
                <input type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} title="To date" />
                <div style={{ position: 'relative' }}>
                    <MdSearch style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontSize: 16 }} />
                    <input type="text" placeholder="Search items, notes..."
                        value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
                        style={{ paddingLeft: 32 }} />
                </div>
                {(filters.location || filters.category || filters.dateFrom || filters.dateTo || filters.search) && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ location: '', category: '', dateFrom: '', dateTo: '', search: '' })}>
                        Clear filters
                    </button>
                )}
            </div>

            {/* ═══ ANALYTICS VIEW ═══ */}
            {activeView === 'analytics' && isAdminUser && !loading && (
                <div style={{ marginBottom: 24 }}>
                    {events.length === 0 ? (
                        <div className="waste-empty">
                            <div className="empty-icon">📊</div>
                            <p style={{ fontWeight: 600, fontSize: 16 }}>No data for analytics</p>
                            <p>Log some waste events to see charts.</p>
                        </div>
                    ) : (
                        <>
                            {/* Row 1: Pie + Bar */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                                {/* Waste by Category (Pie) */}
                                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20 }}>
                                    <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        🥧 Waste by Category
                                    </h3>
                                    {categoryChartData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={280}>
                                            <PieChart>
                                                <Pie data={categoryChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={true}>
                                                    {categoryChartData.map((entry, i) => (
                                                        <Cell key={i} fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip content={<CustomTooltip />} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>No category data</div>
                                    )}
                                </div>

                                {/* Waste by Location (Bar) */}
                                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20 }}>
                                    <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        📊 Waste by Location
                                    </h3>
                                    {locationChartData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={280}>
                                            <BarChart data={locationChartData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                                                <XAxis type="number" tickFormatter={v => `£${v}`} tick={{ fontSize: 11 }} />
                                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                                                <Tooltip content={<CustomTooltip />} />
                                                <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>No location data</div>
                                    )}
                                </div>
                            </div>

                            {/* Row 2: Trend + Top Items */}
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
                                {/* Daily Waste Trend (Line) */}
                                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20 }}>
                                    <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        📈 Daily Waste Trend
                                    </h3>
                                    {trendData.length > 1 ? (
                                        <ResponsiveContainer width="100%" height={260}>
                                            <LineChart data={trendData} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                                                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                                <YAxis tickFormatter={v => `£${v}`} tick={{ fontSize: 11 }} />
                                                <Tooltip content={<CustomTooltip />} />
                                                <Line type="monotone" dataKey="value" stroke="#ef4444" strokeWidth={2} dot={{ r: 4, fill: '#ef4444' }} activeDot={{ r: 6 }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>
                                            Need more than 1 day of data for trend chart
                                        </div>
                                    )}
                                </div>

                                {/* Top 5 Wasted Items */}
                                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20 }}>
                                    <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        🏆 Top Wasted Items
                                    </h3>
                                    {topItemsData.length > 0 ? (
                                        <div>
                                            {topItemsData.map((item, idx) => (
                                                <div key={idx} style={{
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                    padding: '10px 0', borderBottom: idx < topItemsData.length - 1 ? '1px solid var(--color-border)' : 'none',
                                                }}>
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                                                            <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>#{idx + 1}</span>
                                                            {item.fullName}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                                            {item.count} event{item.count !== 1 ? 's' : ''} · {item.qty} units
                                                        </div>
                                                    </div>
                                                    <div style={{ fontWeight: 700, color: '#ef4444', fontSize: 14 }}>
                                                        {formatCurrency(item.value)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>No item data</div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* ═══ TABLE VIEW ═══ */}
            {activeView === 'table' && (
                <>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>Loading waste events...</div>
                    ) : filteredEvents.length === 0 ? (
                        <div className="waste-empty">
                            <div className="empty-icon">🗑️</div>
                            <p style={{ fontWeight: 600, fontSize: 16 }}>No waste events found</p>
                            <p>Click "Log Waste Event" to record your first waste entry.</p>
                        </div>
                    ) : (
                        <div className="waste-table-wrapper">
                            <table className="data-table" style={{ fontSize: 13 }}>
                                <thead>
                                    <tr>
                                        <th>DATE</th>
                                        {isAdminUser && <th>LOCATION</th>}
                                        <th>ITEM</th>
                                        <th style={{ textAlign: 'right' }}>QTY</th>
                                        <th style={{ textAlign: 'right' }}>VALUE</th>
                                        <th>CATEGORY</th>
                                        <th>SOURCE</th>
                                        <th>SUBMITTED BY</th>
                                        <th>NOTES</th>
                                        <th>ACTIONS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredEvents.map(event => {
                                        const catInfo = getCategoryInfo(event.category);
                                        return (
                                            <tr key={event.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedEvent(event)}>
                                                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{formatDate(event.created_at)}</td>
                                                {isAdminUser && <td style={{ fontSize: 12 }}>📍 {event.location_name}</td>}
                                                <td style={{ fontWeight: 500 }}>{event.item_name}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 500 }}>{event.quantity} {event.item_unit}</td>
                                                <td style={{ textAlign: 'right', color: '#ef4444', fontWeight: 600 }}>{formatCurrency(event.total_value)}</td>
                                                <td>
                                                    <span className="waste-category-badge" style={{ background: `${catInfo.color}22`, color: catInfo.color }}>
                                                        {catInfo.icon} {catInfo.label}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className={`waste-source-badge ${event.source === 'auto_expiry' ? 'auto' : 'manual'}`}>
                                                        {event.source === 'auto_expiry' ? '🤖 Auto' : '👤 Manual'}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: 12 }}>{event.submitted_by?.name || '—'}</td>
                                                <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                    {event.notes || '—'}
                                                </td>
                                                <td>
                                                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setSelectedEvent(event); }} title="View Details">
                                                        <MdVisibility style={{ fontSize: 16 }} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Summary footer */}
                    {!loading && filteredEvents.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>
                            <span>{filteredEvents.length} waste event{filteredEvents.length !== 1 ? 's' : ''}</span>
                            <span>Total value: <strong style={{ color: '#ef4444' }}>{formatCurrency(filteredEvents.reduce((s, e) => s + (e.total_value || 0), 0))}</strong></span>
                        </div>
                    )}
                </>
            )}

            {/* Modals */}
            {showLogModal && (
                <LogWasteModal
                    onClose={() => setShowLogModal(false)}
                    onSubmitted={fetchEvents}
                    userProfile={{ ...userProfile, uid: userProfile?.id }}
                />
            )}

            {selectedEvent && (
                <WasteDetailModal
                    event={selectedEvent}
                    onClose={() => setSelectedEvent(null)}
                    onUpdated={() => { setSelectedEvent(null); fetchEvents(); }}
                    isAdmin={isAdminUser}
                    userProfile={{ ...userProfile, uid: userProfile?.id }}
                />
            )}
        </div>
    );
};

export default WasteManagement;
