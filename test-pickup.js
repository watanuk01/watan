const order = {
  items: [
    { item_id: 'i1', quantity: 5, base_quantity: 5, selling_price: 20, vat_rate: 0, line_total: 100, vat_amount: 0 }
  ],
  subtotal: 100,
  vat_amount: 0,
  total: 100,
  item_count: 5
};

const verifiedItems = [
  { item_id: 'i1', quantity: 4 }
];

const missingItems = [
  { item_id: 'i1', discrepancy_qty: 1 }
];

let updatedItems = order.items || [];
let newSubtotal = order.subtotal || 0;
let newVatAmount = order.vat_amount || 0;
let newTotal = order.total || 0;
let newItemCount = order.item_count || 0;

if (missingItems && missingItems.length > 0) {
    updatedItems = updatedItems.map(item => {
        const verified = (verifiedItems || []).find(vi => vi.item_id === item.item_id);
        if (verified) {
            const quantity = verified.quantity;
            const base_quantity = item.quantity > 0
                ? Number(((item.base_quantity || item.quantity) / item.quantity * quantity).toFixed(2))
                : quantity;
            const line_total = quantity * (item.selling_price || 0);
            const vat_amount = (line_total * (item.vat_rate || 0)) / 100;
            
            return { ...item, quantity, base_quantity, line_total, vat_amount };
        }
        return item;
    }).filter(item => item.quantity > 0);

    newSubtotal = updatedItems.reduce((sum, item) => sum + (item.line_total || 0), 0);
    newVatAmount = updatedItems.reduce((sum, item) => sum + (item.vat_amount || 0), 0);
    newTotal = newSubtotal + newVatAmount;
    newItemCount = updatedItems.length;
}

console.log(JSON.stringify({ updatedItems, newTotal, newItemCount }, null, 2));
