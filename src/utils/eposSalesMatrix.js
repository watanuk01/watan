/**
 * EPOS Sales Matrix Builder
 *
 * Transforms raw EPOS events + menu items + inventory items into two clean
 * datasets for the Sales Analytics table:
 *
 *   1. menuSalesRows   — one row per (menu item × portion) sold via EPOS
 *   2. inventoryRows   — one row per inventory item consumed (from deductions[])
 *
 * Key design decisions:
 *  - Revenue lives at menu-item level (EPOS sells a "Chicken Biryani", not ingredients)
 *  - Consumption lives at inventory level (deductions[] is already deduplicated by CF)
 *  - No double-counting: we never re-explode recipes on the client side
 *  - Unmapped items are included with partial data and flagged as 'unmapped'
 */

/**
 * Build the full EPOS sales matrix from filtered events.
 *
 * @param {Object[]} filteredEvents   - eposEvents already filtered by date range
 * @param {Object[]} menuItems        - all menu_items for this restaurant
 * @param {Object[]} inventoryItems   - all restaurant_inventory items
 * @returns {{ menuSalesRows: Object[], inventoryRows: Object[] }}
 */
export function buildEposSalesMatrix(filteredEvents, menuItems, inventoryItems) {
    // ── Build fast lookup maps ──────────────────────────────────────────────
    // menuItemMap: id → menu_item
    const menuItemById = {};
    for (const mi of menuItems) menuItemById[mi.id] = mi;

    // menuItemByName: lowercasename → menu_item  (for name-based matching from results[])
    const menuItemByName = {};
    for (const mi of menuItems) menuItemByName[(mi.name || '').toLowerCase()] = mi;

    // inventoryMap: item_id → inventory_item
    const inventoryById = {};
    for (const inv of inventoryItems) {
        if (inv.item_id) inventoryById[inv.item_id] = inv;
        inventoryById[inv.id] = inv; // also index by doc id as fallback
    }

    // ── Aggregate: menu-item-level sales ───────────────────────────────────
    // Key: `${menu_item_name}|||${portion_name}`
    const menuSalesMap = {};

    // Aggregate: inventory-level consumption
    // Key: item_id
    const inventoryConsumptionMap = {};

    for (const event of filteredEvents) {
        const results = event.processing_result?.results || [];

        for (const r of results) {
            // ── Unmapped items ──
            if (r.status === 'unmapped') {
                const key = `__unmapped__|||${r.epos_item_id}`;
                if (!menuSalesMap[key]) {
                    menuSalesMap[key] = {
                        key,
                        menu_item_name: r.epos_item_name,
                        menu_item_id: null,
                        menu_item_category: '',
                        menu_item_model: '',
                        portion_name: r.portion || '—',
                        portion_selling_price: 0,
                        portion_cost_price: 0,
                        qty_sold: 0,
                        epos_revenue: 0,
                        inv_sell_price: 0,
                        inv_cost_price: 0,
                        markup: null,
                        markup_pct: null,
                        status: 'unmapped',
                    };
                }
                menuSalesMap[key].qty_sold += (r.quantity_sold || 0);
                continue;
            }

            if (r.status !== 'processed') continue;

            // ── Processed items ──
            const menuName = r.menu_item || r.epos_item_name || '';
            const portionName = r.portion || 'Regular';
            const key = `${menuName}|||${portionName}`;

            // Resolve menu item details (prefer id stored in result, fallback to name)
            const mi = r.menu_item_id
                ? menuItemById[r.menu_item_id]
                : menuItemByName[menuName.toLowerCase()];

            const matchedPortion = mi?.portions?.find(p =>
                p.name?.toLowerCase() === portionName.toLowerCase()
            ) || mi?.portions?.[0];

            // Selling price: prefer what's stored in result, then live menu item
            const sellingPrice = r.portion_selling_price
                || matchedPortion?.selling_price
                || 0;
            const costPrice = r.portion_cost_price
                || matchedPortion?.cost_price
                || 0;

            const qtySold = r.quantity_sold || 0;

            if (!menuSalesMap[key]) {
                menuSalesMap[key] = {
                    key,
                    menu_item_name: menuName,
                    menu_item_id: r.menu_item_id || mi?.id || null,
                    menu_item_category: r.menu_item_category || mi?.category || '',
                    menu_item_model: r.menu_item_model || mi?.model_type || '',
                    portion_name: portionName,
                    portion_selling_price: sellingPrice,
                    portion_cost_price: costPrice,
                    qty_sold: 0,
                    epos_revenue: 0,
                    status: 'processed',
                };
            }

            menuSalesMap[key].qty_sold += qtySold;
            menuSalesMap[key].epos_revenue += sellingPrice * qtySold;

            // ── Inventory consumption from deductions[] ──
            for (const d of (r.deductions || [])) {
                if (!d.item_id) continue;

                // Resolve live inventory data for stock & prices
                const inv = inventoryById[d.item_id];

                if (!inventoryConsumptionMap[d.item_id]) {
                    inventoryConsumptionMap[d.item_id] = {
                        item_id: d.item_id,
                        item_name: d.item_name || inv?.item_name || '—',
                        unit: d.unit || inv?.unit || '',
                        category_name: d.category_name || inv?.category_name || '—',
                        item_type: d.item_type || inv?.item_type || '—',
                        cost_price: d.cost_price ?? inv?.cost_price ?? 0,
                        selling_price: d.selling_price ?? inv?.selling_price ?? 0,
                        current_stock: inv?.current_stock ?? 0,
                        low_stock_threshold: inv?.low_stock_threshold ?? 5,
                        total_consumed: 0,
                        depletion_events: 0,
                    };
                }

                const row = inventoryConsumptionMap[d.item_id];
                row.total_consumed += d.required || 0;
                if (d.status === 'depleted') row.depletion_events++;
                // Keep prices fresh from live inventory
                if (inv) {
                    row.current_stock = inv.current_stock ?? row.current_stock;
                    row.cost_price = inv.cost_price ?? row.cost_price;
                    row.selling_price = inv.selling_price ?? row.selling_price;
                }
            }
        }

        // Also handle line_items for unmapped events (show EPOS order count)
        // already handled above by iterating results[]
    }

    // ── Finalise menu sales rows ───────────────────────────────────────────
    const menuSalesRows = Object.values(menuSalesMap).map(row => {
        const invSellPrice = row.portion_selling_price > 0
            ? null  // For full menu items, inv price comes from the deductions aggregation
            : 0;

        const markup = (row.portion_selling_price && row.portion_cost_price != null)
            ? row.portion_selling_price - row.portion_cost_price
            : null;

        const markupPct = (markup != null && row.portion_selling_price > 0)
            ? (markup / row.portion_selling_price) * 100
            : null;

        return {
            ...row,
            epos_revenue: Math.round(row.epos_revenue * 100) / 100,
            markup: markup != null ? Math.round(markup * 100) / 100 : null,
            markup_pct: markupPct != null ? Math.round(markupPct * 10) / 10 : null,
        };
    });

    // Sort: processed first (by revenue desc), then unmapped
    menuSalesRows.sort((a, b) => {
        if (a.status === 'unmapped' && b.status !== 'unmapped') return 1;
        if (a.status !== 'unmapped' && b.status === 'unmapped') return -1;
        return b.epos_revenue - a.epos_revenue;
    });

    // ── Finalise inventory rows ────────────────────────────────────────────
    const inventoryRows = Object.values(inventoryConsumptionMap).map(row => {
        const consumptionValue = Math.round(row.total_consumed * row.selling_price * 100) / 100;
        const stockValue = Math.round(row.current_stock * row.selling_price * 100) / 100;

        let depletionRisk = 'ok';
        if (row.current_stock <= 0) depletionRisk = 'out';
        else if (row.current_stock <= row.low_stock_threshold) depletionRisk = 'low';

        return {
            ...row,
            total_consumed: Math.round(row.total_consumed * 1000) / 1000,
            consumption_value: consumptionValue,
            stock_value: stockValue,
            depletion_risk: depletionRisk,
        };
    });

    // Sort: out-of-stock first, then low, then ok; within each group by consumed desc
    inventoryRows.sort((a, b) => {
        const riskOrder = { out: 0, low: 1, ok: 2 };
        const rDiff = (riskOrder[a.depletion_risk] || 2) - (riskOrder[b.depletion_risk] || 2);
        if (rDiff !== 0) return rDiff;
        return b.total_consumed - a.total_consumed;
    });

    return { menuSalesRows, inventoryRows };
}

/**
 * Get unique filter options from the matrix rows.
 * @param {Object[]} menuSalesRows
 * @param {Object[]} inventoryRows
 */
export function getEposFilterOptions(menuSalesRows, inventoryRows) {
    const menuCategories = [...new Set(
        menuSalesRows.map(r => r.menu_item_category).filter(Boolean)
    )].sort();

    const menuModels = [...new Set(
        menuSalesRows.map(r => r.menu_item_model).filter(Boolean)
    )].sort();

    const invCategories = [...new Set(
        inventoryRows.map(r => r.category_name).filter(c => c !== '—')
    )].sort();

    const invTypes = [...new Set(
        inventoryRows.map(r => r.item_type).filter(t => t !== '—')
    )].sort();

    return { menuCategories, menuModels, invCategories, invTypes };
}
