/**
 * Seed script — creates sample invoice data for testing.
 * Fetches REAL restaurant users from Firestore and seeds invoices against them.
 *
 * Usage: import and call seedInvoiceData() from a React component or the console.
 */

import {
    collection, addDoc, getDocs, query, where, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

const rand = (min, max) => Math.round((Math.random() * (max - min) + min) * 100) / 100;
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const ORDER_ITEMS = [
    { item_id: 'chilli_powder', description: 'Chilli Powder', unit: 'kg', vat_rate: 0, vat_exempt: true, price_range: [1.5, 3.0] },
    { item_id: 'curry_paste', description: 'Curry Paste', unit: 'kg', vat_rate: 20, vat_exempt: false, price_range: [3.0, 5.0] },
    { item_id: 'basmati_rice', description: 'Basmati Rice', unit: 'kg', vat_rate: 0, vat_exempt: true, price_range: [1.0, 2.5] },
    { item_id: 'cooking_oil', description: 'Cooking Oil', unit: 'ltr', vat_rate: 20, vat_exempt: false, price_range: [2.0, 4.0] },
    { item_id: 'chicken_breast', description: 'Chicken Breast', unit: 'kg', vat_rate: 0, vat_exempt: true, price_range: [4.0, 7.0] },
    { item_id: 'lamb_mince', description: 'Lamb Mince', unit: 'kg', vat_rate: 0, vat_exempt: true, price_range: [6.0, 9.0] },
    { item_id: 'onions', description: 'Onions', unit: 'kg', vat_rate: 0, vat_exempt: true, price_range: [0.5, 1.5] },
    { item_id: 'tomatoes', description: 'Tomatoes', unit: 'kg', vat_rate: 0, vat_exempt: true, price_range: [1.0, 2.0] },
    { item_id: 'disposable_containers', description: 'Disposable Containers', unit: 'pack', vat_rate: 20, vat_exempt: false, price_range: [5.0, 10.0] },
    { item_id: 'napkins', description: 'Napkins', unit: 'pack', vat_rate: 20, vat_exempt: false, price_range: [2.0, 4.0] },
];

const PRODUCTION_ITEMS = [
    { item_id: 'chicken_tikka', name: 'Chicken Tikka', unit: 'kg', vat_rate: 20, vat_exempt: false },
    { item_id: 'lamb_kebab', name: 'Lamb Kebab', unit: 'kg', vat_rate: 20, vat_exempt: false },
    { item_id: 'seekh_kebab', name: 'Seekh Kebab', unit: 'kg', vat_rate: 20, vat_exempt: false },
    { item_id: 'chicken_curry', name: 'Chicken Curry', unit: 'kg', vat_rate: 20, vat_exempt: false },
    { item_id: 'dal_makhani', name: 'Dal Makhani', unit: 'kg', vat_rate: 0, vat_exempt: true },
];

const SUPPLIER = {
    name: 'Watan Central Kitchen',
    address: 'Central Kitchen, London, UK',
    vat_number: '',
    phone: '',
    email: '',
};

/**
 * Fetch real restaurant users from Firestore.
 */
const fetchRealRestaurants = async () => {
    const q = query(
        collection(db, 'users'),
        where('role', 'in', ['restaurant_manager', 'restaurant_manager_non_managed'])
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,                           // Firebase Auth UID — this is the restaurant_id
            name: data.restaurant_name || data.name || 'Unnamed Restaurant',
            address: data.address || '',
            email: data.email || '',
            phone: data.phone || '',
            vat_number: data.vat_number || '',
        };
    });
};

export const seedInvoiceData = async () => {
    const results = { orderInvoices: 0, productionInvoices: 0 };

    // ── Fetch real restaurants ──
    const restaurants = await fetchRealRestaurants();
    if (restaurants.length === 0) {
        console.warn('⚠️ No restaurant users found in Firestore. Cannot seed order invoices.');
        console.warn('   Please add restaurant_manager users via User Management first.');
        // Still seed production invoices
    }

    // ── ORDER INVOICES ──
    // Create invoices spread over last 60 days (to cover ~8 weeks) across all real restaurants
    if (restaurants.length > 0) {
        const TOTAL_ORDER_INVOICES = Math.max(20, restaurants.length * 8);
        for (let i = 0; i < TOTAL_ORDER_INVOICES; i++) {
            const restaurant = pick(restaurants);
            const daysAgo = randInt(0, 59); // 60 days of data = ~8 weeks
            const invoiceDate = new Date();
            invoiceDate.setDate(invoiceDate.getDate() - daysAgo);
            invoiceDate.setHours(randInt(8, 16), randInt(0, 59), 0, 0);

            // Pick 2-5 random items
            const numItems = randInt(2, 5);
            const shuffled = [...ORDER_ITEMS].sort(() => 0.5 - Math.random());
            const lineItems = shuffled.slice(0, numItems).map(item => {
                const qty = randInt(2, 20);
                const unitPrice = rand(item.price_range[0], item.price_range[1]);
                const netAmount = Math.round(qty * unitPrice * 100) / 100;
                const vatRate = item.vat_exempt ? 0 : item.vat_rate;
                const vatAmount = Math.round(netAmount * (vatRate / 100) * 100) / 100;
                return {
                    item_id: item.item_id,
                    description: item.description,
                    quantity: qty,
                    unit: item.unit,
                    unit_price: unitPrice,
                    vat_rate: vatRate,
                    vat_exempt: item.vat_exempt,
                    net_amount: netAmount,
                    vat_amount: vatAmount,
                    gross_amount: Math.round((netAmount + vatAmount) * 100) / 100,
                };
            });

            const subtotal = Math.round(lineItems.reduce((s, li) => s + li.net_amount, 0) * 100) / 100;
            const totalVat = Math.round(lineItems.reduce((s, li) => s + li.vat_amount, 0) * 100) / 100;
            const grandTotal = Math.round((subtotal + totalVat) * 100) / 100;

            // Build VAT summary
            const vatMap = {};
            lineItems.forEach(li => {
                const key = li.vat_exempt ? 'exempt' : `${li.vat_rate}`;
                if (!vatMap[key]) vatMap[key] = { rate: li.vat_rate, label: li.vat_exempt ? 'Exempt' : `${li.vat_rate}%`, net: 0, vat: 0 };
                vatMap[key].net += li.net_amount;
                vatMap[key].vat += li.vat_amount;
            });
            const vatSummary = Object.values(vatMap).map(v => ({ ...v, net: Math.round(v.net * 100) / 100, vat: Math.round(v.vat * 100) / 100 }));

            const invoiceNumber = `INV-2026-${String(i + 100).padStart(4, '0')}`;
            const orderNumber = `ORD-2026-${String(i + 100).padStart(4, '0')}`;

            await addDoc(collection(db, 'invoices'), {
                invoice_number: invoiceNumber,
                type: 'order',
                order_id: `order_seed_${i}`,
                order_number: orderNumber,
                supplier: { ...SUPPLIER },
                customer: {
                    name: restaurant.name,
                    restaurant_name: restaurant.name,
                    restaurant_id: restaurant.id,     // 🔑 Real Firebase Auth UID
                    address: restaurant.address,
                    email: restaurant.email,
                    phone: restaurant.phone,
                    vat_number: restaurant.vat_number,
                },
                invoice_date: Timestamp.fromDate(invoiceDate),
                supply_date: Timestamp.fromDate(invoiceDate),
                line_items: lineItems,
                vat_summary: vatSummary,
                subtotal,
                total_vat: totalVat,
                grand_total: grandTotal,
                discount_type: 'none',
                discount_value: 0,
                discount_amount: 0,
                status: 'issued',
                notes: '',
                created_at: serverTimestamp(),
                updated_at: serverTimestamp(),
            });
            results.orderInvoices++;
        }
    }

    // ── PRODUCTION INVOICES ──
    // Create 15 production invoices spread over last 60 days
    for (let i = 0; i < 15; i++) {
        const item = pick(PRODUCTION_ITEMS);
        const daysAgo = randInt(0, 59);
        const prodDate = new Date();
        prodDate.setDate(prodDate.getDate() - daysAgo);
        prodDate.setHours(randInt(6, 14), randInt(0, 59), 0, 0);

        const qtyProduced = randInt(5, 30);
        const ingredientCost = rand(2.0, 8.0) * qtyProduced;
        const totalIngredientCost = Math.round(ingredientCost * 100) / 100;
        const vatRate = item.vat_exempt ? 0 : (item.vat_rate || 20);
        const vatAmount = Math.round(totalIngredientCost * (vatRate / 100) * 100) / 100;
        const totalWithVat = Math.round((totalIngredientCost + vatAmount) * 100) / 100;

        // Random expiry 30–120 days from production date
        const expiryDate = new Date(prodDate);
        expiryDate.setDate(expiryDate.getDate() + randInt(30, 120));

        const invoiceNumber = `PROD-INV-2026-${String(i + 200).padStart(4, '0')}`;
        const productionNumber = `PROD-${String(i + 200).padStart(4, '0')}`;
        const batchNumber = `BATCH-${String(randInt(1000, 9999))}`;

        await addDoc(collection(db, 'production_invoices'), {
            invoice_number: invoiceNumber,
            production_number: productionNumber,
            production_id: `prod_seed_${i}`,
            type: 'production',
            item_id: item.item_id,
            item_name: item.name,
            item_unit: item.unit,
            quantity_produced: qtyProduced,
            batch_number: batchNumber,
            total_ingredient_cost: totalIngredientCost,
            vat_rate: vatRate,
            vat_exempt: item.vat_exempt,
            vat_amount: vatAmount,
            total_with_vat: totalWithVat,
            production_date: Timestamp.fromDate(prodDate),
            expiry_date: Timestamp.fromDate(expiryDate),
            chef_name: pick(['Chef Ahmad', 'Chef Rashid', 'Chef Bilal']),
            ingredients_used: [
                { name: 'Raw Material A', quantity: randInt(5, 15), unit: 'kg', cost: rand(1.0, 4.0) },
                { name: 'Spice Mix', quantity: rand(0.5, 2.0), unit: 'kg', cost: rand(3.0, 8.0) },
            ],
            notes: '',
            created_at: serverTimestamp(),
        });
        results.productionInvoices++;
    }

    console.log(`✅ Seeded: ${results.orderInvoices} order invoices, ${results.productionInvoices} production invoices`);
    return results;
};
