import React, { useState } from 'react';
import {
    addCategory,
    updateCategory,
    deleteCategory,
    toggleCategoryEnabled,
    ITEM_TYPES,
} from '../../services/inventoryService';
import { MdClose, MdEdit, MdDelete, MdAdd, MdSave, MdImage } from 'react-icons/md';
import toast from 'react-hot-toast';
import './Inventory.css';

const CategoryManager = ({ categories, activeType, onClose, onUpdate }) => {
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editIcon, setEditIcon] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newIcon, setNewIcon] = useState('📁');
    const [loading, setLoading] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [togglingId, setTogglingId] = useState(null);
    const [newImage, setNewImage] = useState('');
    const [editImage, setEditImage] = useState('');

    const handleImageUpload = (e, setter) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 500 * 1024) {
            toast.error('Image must be under 500KB');
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => setter(reader.result);
        reader.readAsDataURL(file);
    };

    const typeInfo = ITEM_TYPES.find(t => t.value === activeType) || ITEM_TYPES[0];

    const handleStartEdit = (cat) => {
        setEditingId(cat.id);
        setEditName(cat.name);
        setEditDesc(cat.description || '');
        setEditIcon(cat.icon || '📁');
        setEditImage(cat.image || '');
    };

    const handleSaveEdit = async () => {
        if (!editName.trim()) {
            toast.error('Category name is required');
            return;
        }
        setLoading(true);
        try {
            await updateCategory(editingId, {
                name: editName.trim(),
                description: editDesc.trim(),
                icon: editIcon,
                image: editImage,
            });
            toast.success('Category updated');
            setEditingId(null);
            onUpdate();
        } catch (err) {
            toast.error(err.message || 'Failed to update category');
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newName.trim()) {
            toast.error('Category name is required');
            return;
        }
        setLoading(true);
        try {
            await addCategory({
                name: newName.trim(),
                description: newDesc.trim(),
                icon: newIcon,
                image: newImage,
                item_type: activeType,
                sort_order: categories.length + 1,
            });
            toast.success(`Category "${newName}" created under ${typeInfo.label}`);
            setShowAddForm(false);
            setNewName('');
            setNewDesc('');
            setNewIcon('📁');
            setNewImage('');
            onUpdate();
        } catch (err) {
            toast.error(err.message || 'Failed to create category');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (cat) => {
        try {
            await deleteCategory(cat.id);
            toast.success(`Category "${cat.name}" deleted`);
            setDeletingId(null);
            onUpdate();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const ICON_SUGGESTIONS = {
        grocery: ['🛒', '🧂', '🫒', '🥫', '🍶', '🧴', '🥤', '🍬', '🌾', '🧈'],
        raw_meat: ['🐔', '🐑', '🐟', '🦐', '🥩', '🍖', '🐄', '🦃', '🐓', '🫎'],
        cooked_meat: ['🍛', '🍲', '🥘', '🍗', '🍖', '🫕', '🥧', '🧆', '🌯', '🥙'],
    };

    const icons = ICON_SUGGESTIONS[activeType] || ICON_SUGGESTIONS.grocery;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h2>{typeInfo.icon} {typeInfo.label} Categories</h2>
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                            Manage sub-categories for {typeInfo.label.toLowerCase()} items
                        </p>
                    </div>
                    <button className="modal-close" onClick={onClose}><MdClose /></button>
                </div>

                <div className="modal-body">
                    {categories.length === 0 && !showAddForm ? (
                        <div className="empty-state" style={{ padding: 'var(--space-8) 0' }}>
                            <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
                                No categories yet for {typeInfo.label}. Add your first category.
                            </p>
                            <button
                                className="btn btn-primary btn-md"
                                onClick={() => setShowAddForm(true)}
                            >
                                <MdAdd /> Add Category
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="category-list">
                                {categories.map(cat => (
                                    <div key={cat.id} className="category-row">
                                        {editingId === cat.id ? (
                                            <>
                                                <input
                                                    type="text"
                                                    className="form-input"
                                                    value={editIcon}
                                                    onChange={(e) => setEditIcon(e.target.value)}
                                                    style={{ width: 50, textAlign: 'center', padding: 'var(--space-2)' }}
                                                />
                                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                                    <input
                                                        type="text"
                                                        className="form-input"
                                                        value={editName}
                                                        onChange={(e) => setEditName(e.target.value)}
                                                        placeholder="Category name"
                                                        style={{ padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}
                                                    />
                                                    <input
                                                        type="text"
                                                        className="form-input"
                                                        value={editDesc}
                                                        onChange={(e) => setEditDesc(e.target.value)}
                                                        placeholder="Description"
                                                        style={{ padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)' }}
                                                    />
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
                                                        {editImage && (
                                                            <img src={editImage} alt="Preview" style={{ width: 80, height: 80, borderRadius: 'var(--radius-md)', objectFit: 'cover', border: '1px solid var(--color-border)' }} />
                                                        )}
                                                        <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                                                            <MdImage /> {editImage ? 'Change Image' : 'Add Image'}
                                                            <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, setEditImage)} style={{ display: 'none' }} />
                                                        </label>
                                                        {editImage && <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => setEditImage('')}>Remove</button>}
                                                    </div>
                                                </div>
                                                <div className="category-row-actions">
                                                    <button className="btn btn-primary btn-sm" onClick={handleSaveEdit} disabled={loading}>
                                                        <MdSave />
                                                    </button>
                                                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                                                        <MdClose />
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="category-row-icon">
                                                    {cat.image ? (
                                                        <img src={cat.image} alt={cat.name} style={{ width: 40, height: 40, borderRadius: 'var(--radius-sm)', objectFit: 'cover' }} />
                                                    ) : (
                                                        cat.icon
                                                    )}
                                                </div>
                                                <div className="category-row-info" style={{ flex: 1 }}>
                                                    <div className="category-row-name">{cat.name}</div>
                                                    <div className="category-row-desc">{cat.description}</div>
                                                </div>
                                                <label className={`toggle-switch ${togglingId === cat.id ? 'toggle-loading' : ''}`} title={cat.enabled !== false ? 'Visible to restaurants' : 'Hidden from restaurants'} style={{ marginRight: 'var(--space-2)' }}>
                                                    <input
                                                        type="checkbox"
                                                        disabled={togglingId === cat.id}
                                                        checked={cat.enabled !== false}
                                                        onChange={async () => {
                                                            try {
                                                                setTogglingId(cat.id);
                                                                await toggleCategoryEnabled(cat.id, cat.enabled === false);
                                                                await onUpdate();
                                                            } catch (err) {
                                                                toast.error('Failed to toggle category');
                                                            } finally {
                                                                setTogglingId(null);
                                                            }
                                                        }}
                                                    />
                                                    <span className="toggle-slider"></span>
                                                </label>
                                                <div className="category-row-actions">
                                                    {deletingId === cat.id ? (
                                                        <>
                                                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)', marginRight: 'var(--space-1)' }}>Delete?</span>
                                                            <button
                                                                className="btn btn-danger btn-sm"
                                                                onClick={() => handleDelete(cat)}
                                                                title="Confirm delete"
                                                            >
                                                                Yes
                                                            </button>
                                                            <button
                                                                className="btn btn-ghost btn-sm"
                                                                onClick={() => setDeletingId(null)}
                                                                title="Cancel"
                                                            >
                                                                No
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                className="btn btn-ghost btn-sm"
                                                                onClick={() => handleStartEdit(cat)}
                                                                title="Edit"
                                                            >
                                                                <MdEdit />
                                                            </button>
                                                            <button
                                                                className="btn btn-ghost btn-sm"
                                                                onClick={() => setDeletingId(cat.id)}
                                                                title="Delete"
                                                                style={{ color: 'var(--color-danger)', fontSize: '18px' }}
                                                            >
                                                                <MdDelete size={18} />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Add New Category */}
                            {showAddForm ? (
                                <div className="category-add-form" style={{ marginTop: 'var(--space-4)' }}>
                                    <div className="form-group">
                                        <label className="form-label">Icon</label>
                                        <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                                            {icons.map((icon, i) => (
                                                <button
                                                    key={i}
                                                    type="button"
                                                    className={`icon-pick-btn ${newIcon === icon ? 'active' : ''}`}
                                                    onClick={() => setNewIcon(icon)}
                                                >
                                                    {icon}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Category Name *</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            placeholder={`e.g. ${activeType === 'grocery' ? 'Sauces & Condiments' : activeType === 'raw_meat' ? 'Chicken Items' : 'Chicken Dishes'}`}
                                            autoFocus
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Description</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={newDesc}
                                            onChange={(e) => setNewDesc(e.target.value)}
                                            placeholder="Brief description of this category"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Category Image</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                            {newImage && (
                                                <img src={newImage} alt="Preview" style={{ width: 80, height: 80, borderRadius: 'var(--radius-md)', objectFit: 'cover', border: '1px solid var(--color-border)' }} />
                                            )}
                                            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                                                <MdImage /> {newImage ? 'Change Image' : 'Add Image'}
                                                <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, setNewImage)} style={{ display: 'none' }} />
                                            </label>
                                            {newImage && <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => setNewImage('')}>Remove</button>}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                                        <button className="btn btn-ghost btn-md" onClick={() => setShowAddForm(false)}>Cancel</button>
                                        <button className="btn btn-primary btn-md" onClick={handleAdd} disabled={loading}>
                                            <MdAdd /> Create Category
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    className="btn btn-secondary btn-md w-full"
                                    style={{ marginTop: 'var(--space-4)' }}
                                    onClick={() => setShowAddForm(true)}
                                >
                                    <MdAdd /> Add Category
                                </button>
                            )}
                        </>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary btn-md" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

export default CategoryManager;
