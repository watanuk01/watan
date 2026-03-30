import React, { useState, useRef, useEffect } from 'react';
import { getCategories, addItem, updateItem, getItems, findItemByNameAndType, adjustStockBatchAware, CONTAINER_UNITS, getConversionSummary } from '../../services/inventoryService';
import {
    MdFileUpload,
    MdFileDownload,
    MdCheckCircle,
    MdWarning,
    MdClose,
    MdDelete,
    MdInfo,
    MdHelp,
    MdHistory,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import './Inventory.css';

const BulkUpload = () => {
    const [file, setFile] = useState(null);
    const [previewData, setPreviewData] = useState([]);
    const [errors, setErrors] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [config, setConfig] = useState({
        behavior: 'upsert', // 'add', 'update', 'upsert'
    });
    const fileInputRef = useRef(null);

    // Columns for the template
    const COLUMNS = [
        { label: 'Item Name*', key: 'name', type: 'string', required: true, width: 30 },
        { label: 'Item Type*', key: 'item_type', type: 'dropdown', options: ['grocery', 'raw_meat'], required: true, width: 15 },
        { label: 'Category*', key: 'category', type: 'string', required: true, width: 20 },
        { label: 'Unit*', key: 'unit', type: 'string', required: true, width: 10 },
        { label: 'Current Quantity', key: 'current_stock', type: 'number', width: 15, note: 'ReadOnly in download' },
        { label: 'Add/Update Stock', key: 'new_stock', type: 'number', width: 15, note: 'Enter quantity to ADD' },
        { label: 'Actual Cost', key: 'cost_price', type: 'number', width: 12 },
        { label: 'Selling Price', key: 'selling_price', type: 'number', width: 12 },
        { label: 'Min Stock', key: 'min_stock', type: 'number', width: 12 },
        { label: 'Vendor', key: 'vendor', type: 'string', width: 20 },
        { label: 'VAT Rate', key: 'vat_rate', type: 'number', options: [0, 5, 20], width: 10 },
        { label: 'Storage', key: 'storage_type', type: 'dropdown', options: ['ambient', 'chilled', 'frozen'], width: 12 },
    ];

    const handleDownloadTemplate = async () => {
        try {
            const categories = await getCategories();
            const allItems = await getItems();

            // Filter out cooked meat items — those are managed via Production only
            const currentItems = allItems.filter(item => item.item_type !== 'cooked_meat');
            const nonCookedCategories = categories.filter(c => c.item_type !== 'cooked_meat');

            // 1. Create Instructions Sheet
            const instructions = [
                ['INVENTORY BULK UPLOAD INSTRUCTIONS'],
                [''],
                ['HOW TO USE:'],
                ['1. Go to the "Upload Template" sheet.'],
                ['2. Your existing Grocery & Raw Meat items are pre-filled for easy editing.'],
                ['3. Mandatory fields are marked with an asterisk (*).'],
                ['4. Item Type must be one of: grocery, raw_meat'],
                ['5. Category name must match an existing category in the system exactly.'],
                ['6. "Current Quantity" is read-only — it shows your current stock for reference.'],
                ['7. "Add/Update Stock" column: Enter the quantity you want to ADD to current stock.'],
                ['8. Valid VAT rates: 0, 5, 20. If 0 is entered, item is marked as VAT Exempt.'],
                ['9. To add a new item, fill in the empty rows at the bottom.'],
                [''],
                ['⚠️  IMPORTANT — SAVING ON MAC (Apple Numbers):'],
                ['If you open this file in Apple Numbers, DO NOT just press Cmd+S to save.'],
                ['Instead: Go to File → Export To → Excel (.xlsx), then upload that exported file.'],
                ['Saving normally in Numbers creates a .numbers file which cannot be uploaded.'],
                [''],
                ['ℹ️  NOTE: Cooked Meat items are NOT included in this template.'],
                ['Cooked Meat stock is managed automatically via the Production module.'],
                [''],
                ['AVAILABLE CATEGORIES (Grocery & Raw Meat):'],
                ...nonCookedCategories.map(c => [c.name, `(${c.item_type.toUpperCase()})`]),
            ];
            const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
            wsInstructions['!cols'] = [{ wch: 70 }, { wch: 20 }];

            // 2. Create Current Inventory Sheet (reformatted to match reference)
            const inventoryData = currentItems.map((item, idx) => {
                // Build Quantity/Size from conversion summary if available
                let quantitySize = '—';
                if (item.unit_conversion?.has_conversion && item.unit_conversion.levels?.length > 0) {
                    // e.g. "10 x 2 kg" from levels
                    quantitySize = item.unit_conversion.levels
                        .map(lv => `${lv.factor} ${lv.to}`)
                        .join(' × ');
                }
                return {
                    'S.No': idx + 1,
                    'Item Name': item.name,
                    'Category': item.category_name || '',
                    'Vendors': item.vendor || '',
                    'Quantity/Size': quantitySize,
                    'Unit': item.unit || '',
                    'Unit Price': item.cost_price || 0,
                    'Total Quantity Stock In': item.current_stock || 0,
                    'Stock Value': Math.round(((item.current_stock || 0) * (item.cost_price || 0)) * 100) / 100,
                };
            });
            const wsInventory = XLSX.utils.json_to_sheet(inventoryData);
            wsInventory['!cols'] = [
                { wch: 6 },   // S.No
                { wch: 30 },  // Item Name
                { wch: 18 },  // Category
                { wch: 22 },  // Vendors
                { wch: 18 },  // Quantity/Size
                { wch: 10 },  // Unit
                { wch: 12 },  // Unit Price
                { wch: 22 },  // Total Quantity Stock In
                { wch: 14 },  // Stock Value
            ];

            // 3. Create Upload Template Sheet
            // Include current grocery & raw meat items for easy update
            const templateRows = currentItems.map(item => ({
                'Item Name*': item.name,
                'Item Type*': item.item_type,
                'Category*': item.category_name,
                'Unit*': item.unit,
                'Current Quantity': item.current_stock || 0,
                'Add/Update Stock': 0,
                'Actual Cost': item.cost_price || 0,
                'Selling Price': item.selling_price || 0,
                'Min Stock': item.min_stock || 0,
                'Vendor': item.vendor || '',
                'VAT Rate': item.vat_rate || 20,
                'Storage': item.storage_type || 'ambient',
            }));

            // Add some empty rows for new items
            for (let i = 0; i < 5; i++) {
                templateRows.push({
                    'Item Name*': '',
                    'Item Type*': 'grocery',
                    'Category*': '',
                    'Unit*': 'kg',
                    'Current Quantity': '',
                    'Add/Update Stock': 0,
                    'Unit Price': 0,
                    'Selling Price': 0,
                    'Min Stock': 0,
                    'Vendor': '',
                    'VAT Rate': 20,
                    'Storage': 'ambient',
                });
            }

            const wsTemplate = XLSX.utils.json_to_sheet(templateRows);

            // Set Column Widths
            wsTemplate['!cols'] = COLUMNS.map(c => ({ wch: c.width }));

            // Create Workbook
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');
            XLSX.utils.book_append_sheet(wb, wsTemplate, 'Upload Template');
            XLSX.utils.book_append_sheet(wb, wsInventory, 'Current Inventory');

            // Download
            XLSX.writeFile(wb, `Watan_Inventory_Template_${new Date().toISOString().split('T')[0]}.xlsx`);
            toast.success('Excel template downloaded (Grocery & Raw Meat only)');
        } catch (err) {
            console.error(err);
            toast.error('Failed to generate template');
        }
    };

    const parseXLSX = (file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // Try to find the template sheet
                const sheetName = workbook.SheetNames.find(n => n.includes('Template')) || workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                if (jsonData.length === 0) {
                    setErrors(['No data found in the template sheet']);
                    return;
                }

                // Map Excel headers to internal keys
                const rows = jsonData.map((row, idx) => {
                    const mapped = {
                        name: row['Item Name*'] || row['Item Name'],
                        item_type: (row['Item Type*'] || row['Item Type'] || '').toLowerCase(),
                        category: row['Category*'] || row['Category'],
                        unit: row['Unit*'] || row['Unit'],
                        quantity_current: Number(row['Current Quantity']) || 0,
                        quantity_add: Number(row['Add/Update Stock']) || 0,
                        cost_price: Number(row['Actual Cost'] || row['Unit Price']) || 0,
                        selling_price: Number(row['Selling Price']) || 0,
                        min_stock: Number(row['Min Stock']) || 0,
                        vendor: row['Vendor'] || '',
                        vat_rate: Number(row['VAT Rate']) || 20,
                        storage_type: (row['Storage'] || 'ambient').toLowerCase(),
                        _rowNum: idx + 2
                    };
                    return mapped;
                }).filter(r => r.name); // Skip empty name rows

                // Validation
                const rowErrors = [];
                rows.forEach(r => {
                    if (!r.name) rowErrors.push(`Row ${r._rowNum}: Name is missing`);
                    if (!r.item_type) rowErrors.push(`Row ${r._rowNum}: Type is missing`);
                    if (!r.category) rowErrors.push(`Row ${r._rowNum}: Category is missing`);

                    const validTypes = ['grocery', 'raw_meat'];
                    if (r.item_type === 'cooked_meat') {
                        rowErrors.push(`Row ${r._rowNum}: Cooked Meat items cannot be uploaded here. Use the Production module instead.`);
                    } else if (r.item_type && !validTypes.includes(r.item_type)) {
                        rowErrors.push(`Row ${r._rowNum}: Invalid Type "${r.item_type}". Must be grocery or raw_meat.`);
                    }

                    // Warn if unit is a container type (conversion data can't be set via Excel)
                    if (r.unit && CONTAINER_UNITS.includes(r.unit.toLowerCase())) {
                        rowErrors.push(`Row ${r._rowNum}: ⚠️ "${r.name}" uses container unit "${r.unit}". Unit breakdown must be set via Item Form after upload.`);
                    }
                });

                setPreviewData(rows);
                setErrors(rowErrors);
            } catch (err) {
                console.error(err);
                toast.error('Error reading Excel file');
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleFileSelect = (selectedFile) => {
        if (!selectedFile) return;
        const extension = selectedFile.name.split('.').pop().toLowerCase();
        if (extension !== 'xlsx' && extension !== 'xls') {
            toast.error('Please upload an Excel file (.xlsx or .xls)');
            return;
        }

        setFile(selectedFile);
        setUploadResult(null);
        parseXLSX(selectedFile);
    };

    const handleUpload = async () => {
        if (previewData.length === 0) return;
        setUploading(true);

        try {
            const categories = await getCategories();
            let successful = 0;
            let updated = 0;
            let failed = 0;
            let batchesCreated = 0;
            const uploadErrors = [];

            for (const row of previewData) {
                try {
                    // 1. Validate Category
                    const cat = categories.find(c => c.name.toLowerCase() === row.category?.toLowerCase());
                    if (!cat) {
                        uploadErrors.push(`Row ${row._rowNum}: Category "${row.category}" not found. Please create it first.`);
                        failed++;
                        continue;
                    }

                    // 2. Check if item exists
                    const existing = await findItemByNameAndType(row.name, row.item_type);

                    const itemData = {
                        name: row.name,
                        item_type: row.item_type,
                        category_id: cat.id,
                        category_name: cat.name,
                        unit: row.unit || 'kg',
                        min_stock: row.min_stock,
                        low_stock_threshold: row.min_stock,
                        cost_price: row.cost_price,
                        selling_price: row.selling_price,
                        storage_type: row.storage_type,
                        vendor: row.vendor,
                        vat_rate: row.vat_rate,
                        vat_exempt: row.vat_rate === 0,
                    };

                    const isBatchTracked = row.item_type === 'raw_meat';
                    const stockChange = row.quantity_add || 0;

                    if (existing) {
                        // ── UPDATE EXISTING ITEM ──
                        if (isBatchTracked && stockChange !== 0) {
                            // Update item fields (without manually touching current_stock)
                            await updateItem(existing.id, itemData);

                            // Use batch-aware adjustment to create/deduct batches
                            await adjustStockBatchAware(
                                { ...existing, ...itemData, id: existing.id },
                                stockChange,
                                {
                                    reason: 'Bulk upload stock update',
                                    source: 'bulk_upload',
                                    mode: stockChange > 0 ? 'new_batch' : 'fifo',
                                }
                            );
                            if (stockChange > 0) batchesCreated++;
                        } else {
                            // Grocery or no stock change — simple update
                            const newStock = (existing.current_stock || 0) + stockChange;
                            await updateItem(existing.id, {
                                ...itemData,
                                current_stock: newStock
                            });
                        }
                        updated++;
                    } else {
                        // ── ADD NEW ITEM ──
                        if (isBatchTracked && stockChange > 0) {
                            // Create item with 0 stock first,
                            // then use batch-aware adjustment to create a proper batch
                            const newItem = await addItem({
                                ...itemData,
                                current_stock: 0,
                            });
                            await adjustStockBatchAware(
                                { ...itemData, id: newItem.id },
                                stockChange,
                                {
                                    reason: 'Initial stock via bulk upload',
                                    source: 'bulk_upload',
                                    mode: 'new_batch',
                                }
                            );
                            batchesCreated++;
                        } else {
                            // Grocery — simple add with stock
                            await addItem({
                                ...itemData,
                                current_stock: stockChange,
                            });
                        }
                        successful++;
                    }
                } catch (err) {
                    failed++;
                    uploadErrors.push(`Row ${row._rowNum}: ${err.message}`);
                }
            }

            setUploadResult({ successful, updated, failed, batchesCreated, errors: uploadErrors });
            const batchMsg = batchesCreated > 0 ? ` (${batchesCreated} batch${batchesCreated > 1 ? 'es' : ''} created)` : '';
            toast.success(`Processed ${successful + updated} items total${batchMsg}`);
        } catch (err) {
            console.error(err);
            toast.error('Bulk upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleClear = () => {
        setFile(null);
        setPreviewData([]);
        setErrors([]);
        setUploadResult(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <div className="inventory-page">
            <div className="page-header">
                <div>
                    <h2 className="page-title">Bulk Inventory Management</h2>
                    <p className="page-subtitle">Download, update, and re-upload your inventory via Excel</p>
                </div>
                <div className="header-actions">
                    <button className="btn btn-secondary btn-md" onClick={handleDownloadTemplate}>
                        <MdFileDownload /> Download Template & Data
                    </button>
                </div>
            </div>

            <div className="info-banner" style={{ marginBottom: 'var(--space-6)', background: 'var(--color-surface-hover)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', display: 'flex', gap: 'var(--space-3)', border: '1px solid var(--color-border)' }}>
                <MdInfo style={{ color: 'var(--color-primary)', fontSize: '24px', flexShrink: 0 }} />
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    <strong>How to use:</strong> Download the template, which includes your <strong>Grocery & Raw Meat</strong> inventory. Update price, stock, or settings in the "Upload Template" sheet. Use the <strong>"Add/Update Stock"</strong> column to add new arrivals to current levels. Re-upload below.
                    <br />
                    <span style={{ color: 'var(--color-warning)' }}>⚠️ Mac users:</span> If using Apple Numbers, save via <strong>File → Export To → Excel (.xlsx)</strong>. Do not save as .numbers.
                    <br />
                    <span style={{ color: 'var(--color-text-muted)' }}>ℹ️ Cooked Meat items are managed via the Production module and are not included here.</span>
                </div>
            </div>

            {/* Upload Zone */}
            {!file && (
                <div
                    className={`upload-zone ${dragOver ? 'dragover' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        handleFileSelect(e.dataTransfer.files[0]);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div className="upload-zone-icon"><MdFileUpload /></div>
                    <div className="upload-zone-text">
                        Drag & drop your <strong>Excel file</strong> here, or <span style={{ color: 'var(--color-primary)', fontWeight: 'var(--font-semibold)' }}>click to browse</span>
                    </div>
                    <div className="upload-zone-hint">
                        Only .xlsx and .xls files are supported.
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx, .xls"
                        onChange={(e) => handleFileSelect(e.target.files[0])}
                        style={{ display: 'none' }}
                    />
                </div>
            )}

            {/* File Info */}
            {file && !uploadResult && (
                <div className="card">
                    <div className="card-header">
                        <h3>📄 {file.name}</h3>
                        <button className="btn btn-ghost btn-sm" onClick={handleClear} style={{ color: 'var(--color-danger)' }}>
                            <MdDelete /> Remove
                        </button>
                    </div>
                    <div className="card-body">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                            <p style={{ color: 'var(--color-text-secondary)' }}>
                                Ready to process <strong style={{ color: 'var(--color-text-primary)' }}>{previewData.length}</strong> items.
                            </p>
                            {errors.length > 0 && (
                                <span style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                                    <MdWarning style={{ verticalAlign: 'middle' }} /> {errors.length} validation issues found
                                </span>
                            )}
                        </div>

                        {errors.length > 0 && (
                            <div className="error-list" style={{
                                padding: 'var(--space-3)',
                                background: 'rgba(239, 68, 68, 0.08)',
                                borderRadius: 'var(--radius-md)',
                                marginBottom: 'var(--space-4)',
                                fontSize: 'var(--text-sm)',
                                color: '#ef4444',
                                border: '1px solid rgba(239, 68, 68, 0.2)',
                                maxHeight: '200px',
                                overflowY: 'auto'
                            }}>
                                {errors.map((err, i) => <div key={i} style={{ marginBottom: 4 }}>• {err}</div>)}
                            </div>
                        )}

                        <div className="data-table-wrapper" style={{ maxHeight: 400, overflow: 'auto' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Row</th>
                                        <th>Name</th>
                                        <th>Type</th>
                                        <th>Category</th>
                                        <th>Add Stock</th>
                                        <th>Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewData.map((row, i) => (
                                        <tr key={i}>
                                            <td style={{ color: 'var(--color-text-muted)' }}>{row._rowNum}</td>
                                            <td style={{ fontWeight: 600 }}>{row.name}</td>
                                            <td><span className={`badge badge-info`}>{row.item_type}</span></td>
                                            <td>{row.category}</td>
                                            <td style={{ color: row.quantity_add > 0 ? 'var(--color-success)' : 'inherit', fontWeight: row.quantity_add > 0 ? 600 : 400 }}>
                                                {row.quantity_add > 0 ? `+${row.quantity_add}` : '0'} {row.unit}
                                            </td>
                                            <td>£{row.cost_price?.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div className="card-footer" style={{ gap: 'var(--space-3)' }}>
                        <button className="btn btn-secondary btn-md" onClick={handleClear} disabled={uploading}>Cancel</button>
                        <button className="btn btn-primary btn-md" onClick={handleUpload} disabled={uploading || previewData.length === 0 || errors.length > 0}>
                            {uploading ? 'Processing Inventory...' : `Confirm & Upload ${previewData.length} Items`}
                        </button>
                    </div>
                </div>
            )}

            {/* Upload Result */}
            {uploadResult && (
                <div className="card result-card animated-fade-in">
                    <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                        <div className="success-icon" style={{ fontSize: '4rem', marginBottom: 'var(--space-4)' }}>
                            {uploadResult.failed === 0 ? '🎊' : '📉'}
                        </div>
                        <h2 style={{ marginBottom: 'var(--space-2)', color: 'gold' }}>Processing Finished</h2>

                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: uploadResult.batchesCreated > 0 ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)',
                            gap: 'var(--space-4)',
                            margin: 'var(--space-6) 0',
                            background: 'var(--color-bg)',
                            padding: 'var(--space-5)',
                            borderRadius: 'var(--radius-lg)'
                        }}>
                            <div>
                                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-success)' }}>{uploadResult.successful}</div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>New Added</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-primary)' }}>{uploadResult.updated}</div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Updated</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-danger)' }}>{uploadResult.failed}</div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Errors</div>
                            </div>
                            {uploadResult.batchesCreated > 0 && (
                                <div>
                                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: '#3b82f6' }}>{uploadResult.batchesCreated}</div>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Batches Created</div>
                                </div>
                            )}
                        </div>

                        {uploadResult.errors.length > 0 && (
                            <div className="error-report" style={{
                                textAlign: 'left',
                                padding: 'var(--space-4)',
                                background: 'rgba(239, 68, 68, 0.05)',
                                borderRadius: 'var(--radius-md)',
                                marginBottom: 'var(--space-6)',
                                border: '1px solid rgba(239, 68, 68, 0.1)'
                            }}>
                                <h4 style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-2)', fontSize: '14px' }}>Errors encountered:</h4>
                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', maxHeight: 200, overflowY: 'auto' }}>
                                    {uploadResult.errors.map((err, i) => <div key={i} style={{ marginBottom: 4 }}>Row {err}</div>)}
                                </div>
                            </div>
                        )}

                        <button className="btn btn-primary btn-lg" onClick={handleClear} style={{ width: '100%' }}>Done & Continue</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BulkUpload;
