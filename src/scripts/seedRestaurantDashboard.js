/**
 * Seed script — populates Firestore with sample data for manager@watan.com
 * Run from browser console after logging in as admin, or import in a temp component.
 *
 * Usage: import and call  seedRestaurantDashboard('UID_OF_MANAGER')
 */
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const UID = null; // Will be passed as argument

const rand = (min, max) => +(min + Math.random() * (max - min)).toFixed(2);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const uuid = () => doc(collection(db, '_')).id;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

const CATEGORIES = ['Grocery', 'Spices', 'Dairy', 'Vegetables', 'Dry Goods'];
const ITEM_TYPES = ['grocery', 'raw_meat', 'cooked_meat'];
const UNITS = ['kg', 'pcs', 'l', 'box'];

const INVENTORY_ITEMS = [
    { name: 'Basmati Rice', type: 'grocery', cat: 'Grocery', unit: 'kg', cost: 2.50, stock: 45, threshold: 10 },
    { name: 'Chicken Breast', type: 'raw_meat', cat: 'Raw Meat', unit: 'kg', cost: 5.80, stock: 12, threshold: 15 },
    { name: 'Lamb Leg', type: 'raw_meat', cat: 'Raw Meat', unit: 'kg', cost: 12.50, stock: 3, threshold: 5 },
    { name: 'Cooking Oil', type: 'grocery', cat: 'Grocery', unit: 'l', cost: 3.20, stock: 8, threshold: 5 },
    { name: 'Onions', type: 'grocery', cat: 'Vegetables', unit: 'kg', cost: 0.80, stock: 25, threshold: 10 },
    { name: 'Tomatoes', type: 'grocery', cat: 'Vegetables', unit: 'kg', cost: 1.20, stock: 2, threshold: 8 },
    { name: 'Yoghurt', type: 'grocery', cat: 'Dairy', unit: 'kg', cost: 2.00, stock: 6, threshold: 5 },
    { name: 'Garam Masala', type: 'grocery', cat: 'Spices', unit: 'kg', cost: 15.00, stock: 1.5, threshold: 2 },
    { name: 'Turmeric Powder', type: 'grocery', cat: 'Spices', unit: 'kg', cost: 8.00, stock: 0.8, threshold: 1 },
    { name: 'Chilli Powder', type: 'grocery', cat: 'Spices', unit: 'kg', cost: 6.50, stock: 1, threshold: 1.5 },
    { name: 'Minced Lamb', type: 'raw_meat', cat: 'Raw Meat', unit: 'kg', cost: 9.80, stock: 4, threshold: 6 },
    { name: 'Chicken Wings', type: 'raw_meat', cat: 'Raw Meat', unit: 'kg', cost: 4.50, stock: 8, threshold: 5 },
    { name: 'Plain Flour', type: 'grocery', cat: 'Dry Goods', unit: 'kg', cost: 1.10, stock: 18, threshold: 10 },
    { name: 'Ghee', type: 'grocery', cat: 'Dairy', unit: 'kg', cost: 8.50, stock: 3, threshold: 3 },
    { name: 'Saffron', type: 'grocery', cat: 'Spices', unit: 'kg', cost: 450.00, stock: 0.02, threshold: 0.05 },
    { name: 'Cooked Chicken Tikka', type: 'cooked_meat', cat: 'Cooked Meat', unit: 'kg', cost: 12.00, stock: 5, threshold: 4 },
    { name: 'Cooked Seekh Kebab', type: 'cooked_meat', cat: 'Cooked Meat', unit: 'pcs', cost: 1.50, stock: 20, threshold: 15 },
    { name: 'Green Chillies', type: 'grocery', cat: 'Vegetables', unit: 'kg', cost: 3.00, stock: 0, threshold: 2 },
    { name: 'Coriander Bunch', type: 'grocery', cat: 'Vegetables', unit: 'pcs', cost: 0.50, stock: 0, threshold: 5 },
    { name: 'Naan Dough', type: 'grocery', cat: 'Dry Goods', unit: 'kg', cost: 2.00, stock: 10, threshold: 8 },
];

const MENU_ITEMS_DATA = [
    { name: 'Chicken Biryani', cat: 'rice', desc: 'Fragrant basmati rice with tender chicken', allergens: ['d', 'g'],
      portions: [{ name: 'Regular', price: 14.00, cost: 4.20 }, { name: 'Large', price: 18.00, cost: 5.80 }] },
    { name: 'Lamb Karahi', cat: 'karahi', desc: 'Tender lamb cooked in a traditional karahi', allergens: ['d'],
      portions: [{ name: 'Half', price: 12.00, cost: 5.50 }, { name: 'Full', price: 20.00, cost: 9.80 }] },
    { name: 'Chapli Kebabs', cat: 'grill', desc: '3 pieces served with Afghani naan', allergens: ['e', 'g'],
      portions: [{ name: '3 Pieces', price: 25.00, cost: 8.40 }] },
    { name: 'Afghani Mix Grilled Platter', cat: 'platters', desc: 'Selection of kebabs with saffron rice', allergens: ['d', 'n'],
      portions: [{ name: 'Full Platter', price: 68.00, cost: 22.50 }] },
    { name: 'Chicken Tikka', cat: 'grill', desc: 'Marinated chicken grilled to perfection', allergens: ['d'],
      portions: [{ name: 'Regular', price: 10.00, cost: 3.20 }, { name: 'Large', price: 15.00, cost: 5.00 }] },
    { name: 'Seekh Kebab', cat: 'grill', desc: 'Spiced minced lamb kebab', allergens: ['e'],
      portions: [{ name: '2 Pieces', price: 12.00, cost: 3.80 }, { name: '4 Pieces', price: 22.00, cost: 7.20 }] },
    { name: 'Afghani Naan', cat: 'breads', desc: 'Traditional wood-fired naan', allergens: ['g'],
      portions: [{ name: 'Single', price: 3.00, cost: 0.40 }] },
    { name: 'Saffron Rice', cat: 'rice', desc: 'Aromatic saffron-infused basmati', allergens: [],
      portions: [{ name: 'Regular', price: 4.00, cost: 1.20 }, { name: 'Large', price: 6.00, cost: 1.80 }] },
    { name: 'Malai Chicken Boti', cat: 'grill', desc: 'Creamy marinated chicken pieces', allergens: ['d', 'n'],
      portions: [{ name: 'Regular', price: 15.00, cost: 4.80 }] },
    { name: 'Lamb Chops', cat: 'grill', desc: 'Tender grilled lamb chops', allergens: [],
      portions: [{ name: '4 Pieces', price: 20.00, cost: 8.00 }] },
    { name: 'Gulab Jamun', cat: 'desserts', desc: 'Sweet milk dumplings', allergens: ['d', 'g'],
      portions: [{ name: '3 Pieces', price: 5.00, cost: 1.20 }] },
    { name: 'Mango Lassi', cat: 'beverages', desc: 'Creamy mango yoghurt drink', allergens: ['d'],
      portions: [{ name: 'Regular', price: 4.50, cost: 1.00 }] },
];

export const seedRestaurantDashboard = async (restaurantId) => {
    if (!restaurantId) { console.error('Need restaurantId'); return; }
    console.log('🌱 Seeding data for restaurant:', restaurantId);

    // 1. Inventory Items
    for (const item of INVENTORY_ITEMS) {
        const id = uuid();
        await setDoc(doc(db, 'restaurant_inventory', id), {
            restaurant_id: restaurantId,
            item_name: item.name,
            item_type: item.type,
            category: item.cat,
            unit: item.unit,
            base_unit: item.unit,
            cost_price: item.cost,
            current_stock: item.stock,
            low_stock_threshold: item.threshold,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
        });
    }
    console.log(`  ✅ ${INVENTORY_ITEMS.length} inventory items seeded`);

    // 2. Menu Items
    for (const mi of MENU_ITEMS_DATA) {
        const id = uuid();
        await setDoc(doc(db, 'menu_items', id), {
            restaurant_id: restaurantId,
            name: mi.name,
            category: mi.cat,
            description: mi.desc,
            allergens: mi.allergens,
            model_type: 'grill',
            is_active: true,
            portions: mi.portions.map((p, i) => ({
                id: `p_${Date.now().toString(36)}_${i}`,
                name: p.name,
                selling_price: p.price,
                cost_price: p.cost,
                recipe: [],
                sub_items: [],
            })),
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
        });
    }
    console.log(`  ✅ ${MENU_ITEMS_DATA.length} menu items seeded`);

    // 3. CK Orders (spread over last 3 months)
    const statuses = ['delivered', 'delivered', 'delivered', 'pending', 'confirmed', 'preparing', 'cancelled'];
    for (let i = 0; i < 25; i++) {
        const id = uuid();
        const itemCount = 2 + Math.floor(Math.random() * 5);
        const items = [];
        for (let j = 0; j < itemCount; j++) {
            const inv = pick(INVENTORY_ITEMS);
            const qty = Math.round(2 + Math.random() * 10);
            items.push({ item_name: inv.name, quantity: qty, unit_price: inv.cost, total: +(qty * inv.cost).toFixed(2) });
        }
        const total = items.reduce((s, it) => s + it.total, 0);
        const created = daysAgo(Math.floor(Math.random() * 90));
        await setDoc(doc(db, 'ck_orders', id), {
            restaurant_id: restaurantId,
            restaurant_name: 'Watan Restaurant',
            order_number: `CKO-${1000 + i}`,
            items,
            total_amount: +total.toFixed(2),
            status: pick(statuses),
            created_at: created,
            updated_at: created,
        });
    }
    console.log('  ✅ 25 CK orders seeded');

    // 4. Invoices
    for (let i = 0; i < 15; i++) {
        const id = uuid();
        const amount = rand(80, 600);
        const created = daysAgo(Math.floor(Math.random() * 120));
        await setDoc(doc(db, 'invoices', id), {
            restaurant_id: restaurantId,
            invoice_number: `INV-${2000 + i}`,
            grand_total: amount,
            status: 'paid',
            invoice_date: created,
            created_at: created,
        });
    }
    console.log('  ✅ 15 invoices seeded');
    console.log('🎉 Seeding complete! Refresh the dashboard.');
};

export default seedRestaurantDashboard;
