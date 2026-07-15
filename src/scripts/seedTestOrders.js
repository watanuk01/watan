/**
 * Seed Test Orders — Creates test orders from multiple restaurants.
 * 
 * This is a one-time utility. Import and call seedTestOrders() from browser console
 * or use as a temporary admin button.
 */
import { db } from '../firebase';
import {
    collection,
    getDocs,
    deleteDoc,
    doc,
    addDoc,
    serverTimestamp,
} from 'firebase/firestore';

const ORDERS = 'orders';

/**
 * Delete all existing orders
 */
export const clearAllOrders = async () => {
    const snap = await getDocs(collection(db, ORDERS));
    const deleteOps = snap.docs.map(d => deleteDoc(doc(db, ORDERS, d.id)));
    await Promise.all(deleteOps);
    console.log(`🗑️ Deleted ${snap.size} orders`);
    return snap.size;
};

/**
 * Create test orders from 3 restaurants with diverse items.
 * Items come from the actual inventory.
 */
export const seedTestOrders = async (inventoryItems = []) => {
    // First clear existing
    await clearAllOrders();

    // Get items by type for building realistic orders
    const groceryItems = inventoryItems.filter(i => i.item_type === 'grocery' && i.enabled !== false);
    const rawMeatItems = inventoryItems.filter(i => i.item_type === 'raw_meat' && i.enabled !== false);
    const cookedMeatItems = inventoryItems.filter(i => i.item_type === 'cooked_meat' && i.enabled !== false);

    // Pick items (or use fallbacks)
    const pickItems = (arr, count) => arr.slice(0, Math.min(count, arr.length));

    // Define restaurant orders
    const restaurantOrders = [
        {
            restaurant_id: 'manager_uid_southall',
            restaurant_name: 'Watan Southall',
            created_by: 'manager_uid_southall',
            items: [
                ...pickItems(groceryItems, 3).map(i => ({
                    item_id: i.id,
                    item_name: i.name,
                    item_type: i.item_type,
                    category_name: i.category_name || '',
                    unit: i.unit || 'kg',
                    quantity: Math.floor(Math.random() * 10) + 2,
                    cost_price: i.cost_price || 0,
                    selling_price: i.selling_price || i.cost_price || 0,
                    vat_rate: i.vat_rate ?? 20,
                    vat_exempt: i.vat_exempt || false,
                })),
                ...pickItems(rawMeatItems, 2).map(i => ({
                    item_id: i.id,
                    item_name: i.name,
                    item_type: i.item_type,
                    category_name: i.category_name || '',
                    unit: i.unit || 'kg',
                    quantity: Math.floor(Math.random() * 8) + 1,
                    cost_price: i.cost_price || 0,
                    selling_price: i.selling_price || i.cost_price || 0,
                    vat_rate: i.vat_rate || 0,
                    vat_exempt: i.vat_exempt || true,
                })),
            ],
        },
        {
            restaurant_id: 'manager_uid_hayes',
            restaurant_name: 'Watan Hayes',
            created_by: 'manager_uid_hayes',
            items: [
                ...pickItems(groceryItems, 2).map(i => ({
                    item_id: i.id,
                    item_name: i.name,
                    item_type: i.item_type,
                    category_name: i.category_name || '',
                    unit: i.unit || 'kg',
                    quantity: Math.floor(Math.random() * 6) + 3,
                    cost_price: i.cost_price || 0,
                    selling_price: i.selling_price || i.cost_price || 0,
                    vat_rate: i.vat_rate ?? 20,
                    vat_exempt: i.vat_exempt || false,
                })),
                ...pickItems(cookedMeatItems, 2).map(i => ({
                    item_id: i.id,
                    item_name: i.name,
                    item_type: i.item_type,
                    category_name: i.category_name || '',
                    unit: i.unit || 'kg',
                    quantity: Math.floor(Math.random() * 5) + 2,
                    cost_price: i.cost_price || 0,
                    selling_price: i.selling_price || i.cost_price || 0,
                    vat_rate: i.vat_rate || 0,
                    vat_exempt: i.vat_exempt || true,
                })),
            ],
        },
        {
            restaurant_id: 'manager_uid_ealing',
            restaurant_name: 'Watan Ealing',
            created_by: 'manager_uid_ealing',
            items: [
                // Overlap with Southall's first grocery item for testing totals
                ...(groceryItems.length > 0 ? [{
                    item_id: groceryItems[0].id,
                    item_name: groceryItems[0].name,
                    item_type: groceryItems[0].item_type,
                    category_name: groceryItems[0].category_name || '',
                    unit: groceryItems[0].unit || 'kg',
                    quantity: 5,
                    cost_price: groceryItems[0].cost_price || 0,
                    selling_price: groceryItems[0].selling_price || groceryItems[0].cost_price || 0,
                    vat_rate: groceryItems[0].vat_rate ?? 20,
                    vat_exempt: groceryItems[0].vat_exempt || false,
                }] : []),
                ...pickItems(rawMeatItems, 1).map(i => ({
                    item_id: i.id,
                    item_name: i.name,
                    item_type: i.item_type,
                    category_name: i.category_name || '',
                    unit: i.unit || 'kg',
                    quantity: Math.floor(Math.random() * 4) + 3,
                    cost_price: i.cost_price || 0,
                    selling_price: i.selling_price || i.cost_price || 0,
                    vat_rate: i.vat_rate || 0,
                    vat_exempt: i.vat_exempt || true,
                })),
                ...pickItems(cookedMeatItems, 1).map(i => ({
                    item_id: i.id,
                    item_name: i.name,
                    item_type: i.item_type,
                    category_name: i.category_name || '',
                    unit: i.unit || 'kg',
                    quantity: Math.floor(Math.random() * 5) + 2,
                    cost_price: i.cost_price || 0,
                    selling_price: i.selling_price || i.cost_price || 0,
                    vat_rate: i.vat_rate || 0,
                    vat_exempt: i.vat_exempt || true,
                })),
            ],
        },
    ];

    // Generate order numbers
    let orderNum = 1;
    const now = new Date();
    const year = now.getFullYear();

    const createdOrders = [];

    for (const orderData of restaurantOrders) {
        if (orderData.items.length === 0) continue;

        // Calculate totals
        let subtotal = 0;
        let vatAmount = 0;

        const processedItems = orderData.items.map(item => {
            const lineTotal = (item.selling_price || 0) * item.quantity;
            const itemVatRate = item.vat_exempt ? 0 : (item.vat_rate ?? 20);
            const itemVat = lineTotal * (itemVatRate / 100);
            subtotal += lineTotal;
            vatAmount += itemVat;

            return {
                ...item,
                line_total: lineTotal,
                vat_amount: itemVat,
            };
        });

        const orderNumber = `ORD-${year}-${String(orderNum++).padStart(4, '0')}`;

        const order = {
            order_number: orderNumber,
            restaurant_id: orderData.restaurant_id,
            restaurant_name: orderData.restaurant_name,
            status: 'pending',
            items: processedItems,
            item_count: processedItems.length,
            subtotal: Math.round(subtotal * 100) / 100,
            vat_amount: Math.round(vatAmount * 100) / 100,
            total: Math.round((subtotal + vatAmount) * 100) / 100,
            notes: '',
            delivery_partner_id: null,
            delivery_partner_name: null,
            delivery_notes: '',
            delivery_signature: null,
            invoice_number: null,
            created_by: orderData.created_by,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            ready_at: null,
            dispatched_at: null,
            delivered_at: null,
            cancelled_at: null,
        };

        const docRef = await addDoc(collection(db, ORDERS), order);
        createdOrders.push({ id: docRef.id, ...order });
        console.log(`✅ Created order ${orderNumber} for ${orderData.restaurant_name} (${processedItems.length} items)`);
    }

    console.log(`🎉 Seeded ${createdOrders.length} test orders`);
    return createdOrders;
};
