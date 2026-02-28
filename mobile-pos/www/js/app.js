import { initializeDatabase, getDB } from './db.js';
import { generateReceipt, exportSalesToCSV, backupDatabase, restoreDatabase, pickBackupFile } from './utils.js';
import { Capacitor } from '@capacitor/core';

let db;
let currentView = 'dashboard';
let cart = []; // { productId, name, price, quantity }

// Wait for DOM and initialize
document.addEventListener('DOMContentLoaded', async () => {
    await initializeDatabase();
    db = getDB();

    // Setup navigation
    document.querySelectorAll('#bottom-nav button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#bottom-nav button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            showView(btn.dataset.view);
        });
    });

    // Modal close
    document.querySelector('.close').addEventListener('click', () => {
        document.getElementById('modal').style.display = 'none';
    });

    // Load initial view
    showView('dashboard');
});

function showView(view) {
    currentView = view;
    document.getElementById('page-title').innerText = view.charAt(0).toUpperCase() + view.slice(1);
    const content = document.getElementById('content');
    content.innerHTML = ''; // clear

    switch (view) {
        case 'dashboard':
            renderDashboard(content);
            break;
        case 'products':
            renderProducts(content);
            break;
        case 'sales':
            renderSales(content);
            break;
        case 'customers':
            renderCustomers(content);
            break;
        case 'reports':
            renderReports(content);
            break;
        case 'settings':
            renderSettings(content);
            break;
    }
}

// -------------------- Dashboard --------------------
function renderDashboard(container) {
    container.innerHTML = `
        <div class="card">
            <h3>Quick Sale</h3>
            <button onclick="window.location='#sales'">New Sale</button>
        </div>
        <div class="card">
            <h3>Today's Sales</h3>
            <p id="todayTotal">Loading...</p>
        </div>
        <div class="card">
            <h3>Low Stock Products</h3>
            <div id="lowStockList">Loading...</div>
        </div>
    `;
    loadDashboardStats();
}

async function loadDashboardStats() {
    // Today's total
    const today = new Date().toISOString().slice(0,10);
    const result = await db.query('SELECT SUM(total) as total FROM sales WHERE date(created_at) = ?', [today]);
    document.getElementById('todayTotal').innerText = `$${result.values[0]?.total || 0}`;

    // Low stock (stock <= 5)
    const lowStock = await db.query('SELECT * FROM products WHERE stock <= 5');
    let html = '';
    lowStock.values.forEach(p => {
        html += `<div>${p.name} - Stock: ${p.stock}</div>`;
    });
    document.getElementById('lowStockList').innerHTML = html || 'No low stock items';
}

// -------------------- Products --------------------
function renderProducts(container) {
    container.innerHTML = `
        <div class="card">
            <button id="addProductBtn">Add Product</button>
        </div>
        <div id="productList"></div>
    `;
    document.getElementById('addProductBtn').addEventListener('click', () => showProductModal());
    loadProducts();
}

async function loadProducts() {
    const products = await db.query('SELECT * FROM products ORDER BY name');
    let html = '';
    products.values.forEach(p => {
        html += `
            <div class="list-item">
                <div>
                    <strong>${p.name}</strong><br>
                    Price: $${p.price} | Stock: ${p.stock}
                </div>
                <div>
                    <button class="secondary" onclick="editProduct(${p.id})">Edit</button>
                    <button class="danger" onclick="deleteProduct(${p.id})">Delete</button>
                </div>
            </div>
        `;
    });
    document.getElementById('productList').innerHTML = html;
}

window.editProduct = (id) => {
    // Fetch product and show modal
    db.query('SELECT * FROM products WHERE id = ?', [id]).then(res => {
        if (res.values.length) showProductModal(res.values[0]);
    });
};

window.deleteProduct = async (id) => {
    if (confirm('Are you sure?')) {
        await db.run('DELETE FROM products WHERE id = ?', [id]);
        loadProducts();
    }
};

function showProductModal(product = null) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');
    body.innerHTML = `
        <h3>${product ? 'Edit' : 'Add'} Product</h3>
        <div class="form-group">
            <label>Name</label>
            <input id="productName" value="${product?.name || ''}">
        </div>
        <div class="form-group">
            <label>Price</label>
            <input type="number" step="0.01" id="productPrice" value="${product?.price || ''}">
        </div>
        <div class="form-group">
            <label>Stock</label>
            <input type="number" id="productStock" value="${product?.stock || ''}">
        </div>
        <button id="saveProductBtn">Save</button>
    `;
    modal.style.display = 'block';

    document.getElementById('saveProductBtn').onclick = async () => {
        const name = document.getElementById('productName').value;
        const price = parseFloat(document.getElementById('productPrice').value);
        const stock = parseInt(document.getElementById('productStock').value);
        if (!name || isNaN(price)) return alert('Invalid input');

        if (product) {
            await db.run('UPDATE products SET name = ?, price = ?, stock = ? WHERE id = ?', [name, price, stock, product.id]);
        } else {
            await db.run('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', [name, price, stock]);
        }
        modal.style.display = 'none';
        loadProducts();
    };
}

// -------------------- Customers (similar CRUD) --------------------
function renderCustomers(container) {
    container.innerHTML = `
        <div class="card">
            <button id="addCustomerBtn">Add Customer</button>
        </div>
        <div id="customerList"></div>
    `;
    document.getElementById('addCustomerBtn').addEventListener('click', () => showCustomerModal());
    loadCustomers();
}

async function loadCustomers() {
    const customers = await db.query('SELECT * FROM customers ORDER BY name');
    let html = '';
    customers.values.forEach(c => {
        html += `
            <div class="list-item">
                <div>
                    <strong>${c.name}</strong><br>
                    ${c.phone} | ${c.email}
                </div>
                <div>
                    <button class="secondary" onclick="editCustomer(${c.id})">Edit</button>
                    <button class="danger" onclick="deleteCustomer(${c.id})">Delete</button>
                </div>
            </div>
        `;
    });
    document.getElementById('customerList').innerHTML = html;
}

window.editCustomer = (id) => {
    db.query('SELECT * FROM customers WHERE id = ?', [id]).then(res => {
        if (res.values.length) showCustomerModal(res.values[0]);
    });
};

window.deleteCustomer = async (id) => {
    if (confirm('Are you sure?')) {
        await db.run('DELETE FROM customers WHERE id = ?', [id]);
        loadCustomers();
    }
};

function showCustomerModal(customer = null) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');
    body.innerHTML = `
        <h3>${customer ? 'Edit' : 'Add'} Customer</h3>
        <div class="form-group">
            <label>Name</label>
            <input id="customerName" value="${customer?.name || ''}">
        </div>
        <div class="form-group">
            <label>Phone</label>
            <input id="customerPhone" value="${customer?.phone || ''}">
        </div>
        <div class="form-group">
            <label>Email</label>
            <input id="customerEmail" value="${customer?.email || ''}">
        </div>
        <div class="form-group">
            <label>Address</label>
            <textarea id="customerAddress">${customer?.address || ''}</textarea>
        </div>
        <button id="saveCustomerBtn">Save</button>
    `;
    modal.style.display = 'block';

    document.getElementById('saveCustomerBtn').onclick = async () => {
        const name = document.getElementById('customerName').value;
        const phone = document.getElementById('customerPhone').value;
        const email = document.getElementById('customerEmail').value;
        const address = document.getElementById('customerAddress').value;
        if (!name) return alert('Name is required');

        if (customer) {
            await db.run('UPDATE customers SET name = ?, phone = ?, email = ?, address = ? WHERE id = ?', [name, phone, email, address, customer.id]);
        } else {
            await db.run('INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?)', [name, phone, email, address]);
        }
        modal.style.display = 'none';
        loadCustomers();
    };
}

// -------------------- Sales (Cart) --------------------
function renderSales(container) {
    container.innerHTML = `
        <div class="card">
            <h3>New Sale</h3>
            <div class="form-group">
                <label>Customer</label>
                <select id="customerSelect">
                    <option value="">Walk-in Customer</option>
                </select>
            </div>
            <div class="form-group">
                <label>Add Product</label>
                <select id="productSelect">
                    <option value="">Select product</option>
                </select>
                <input type="number" id="productQuantity" value="1" min="1" style="width:60px; display:inline;">
                <button id="addToCartBtn">Add to Cart</button>
            </div>
        </div>
        <div class="card">
            <h3>Cart</h3>
            <div id="cartItems"></div>
            <div class="cart-total" id="cartTotal">$0.00</div>
            <div class="form-group">
                <label>Payment Method</label>
                <select id="paymentMethod">
                    <option>Cash</option>
                    <option>Card</option>
                    <option>UPI</option>
                </select>
            </div>
            <button id="checkoutBtn" class="success">Checkout</button>
        </div>
    `;

    loadCustomersForSelect();
    loadProductsForSelect();

    document.getElementById('addToCartBtn').addEventListener('click', addToCart);
    document.getElementById('checkoutBtn').addEventListener('click', checkout);

    renderCart();
}

async function loadCustomersForSelect() {
    const customers = await db.query('SELECT id, name FROM customers');
    const select = document.getElementById('customerSelect');
    customers.values.forEach(c => {
        select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
}

async function loadProductsForSelect() {
    const products = await db.query('SELECT id, name, price, stock FROM products WHERE stock > 0');
    const select = document.getElementById('productSelect');
    products.values.forEach(p => {
        select.innerHTML += `<option value="${p.id}" data-price="${p.price}" data-stock="${p.stock}">${p.name} - $${p.price} (${p.stock} in stock)</option>`;
    });
}

function addToCart() {
    const productSelect = document.getElementById('productSelect');
    const selected = productSelect.options[productSelect.selectedIndex];
    if (!selected.value) return alert('Select a product');
    const productId = parseInt(selected.value);
    const name = selected.text.split(' - ')[0];
    const price = parseFloat(selected.dataset.price);
    const maxStock = parseInt(selected.dataset.stock);
    const quantity = parseInt(document.getElementById('productQuantity').value) || 1;
    if (quantity > maxStock) return alert(`Only ${maxStock} in stock`);

    const existing = cart.find(item => item.productId === productId);
    if (existing) {
        if (existing.quantity + quantity > maxStock) return alert(`Only ${maxStock - existing.quantity} more available`);
        existing.quantity += quantity;
    } else {
        cart.push({ productId, name, price, quantity });
    }
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cartItems');
    let html = '';
    let total = 0;
    cart.forEach((item, index) => {
        total += item.price * item.quantity;
        html += `
            <div class="cart-item">
                <span>${item.name} x${item.quantity}</span>
                <span>$${(item.price * item.quantity).toFixed(2)}</span>
                <button onclick="removeFromCart(${index})">Remove</button>
            </div>
        `;
    });
    container.innerHTML = html;
    document.getElementById('cartTotal').innerText = `$${total.toFixed(2)}`;
}

window.removeFromCart = (index) => {
    cart.splice(index, 1);
    renderCart();
};

async function checkout() {
    if (cart.length === 0) return alert('Cart empty');
    const customerId = document.getElementById('customerSelect').value || null;
    const paymentMethod = document.getElementById('paymentMethod').value;
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // Start transaction
    await db.run('BEGIN TRANSACTION;');
    try {
        // Insert sale
        const saleResult = await db.run('INSERT INTO sales (customer_id, total, payment_method) VALUES (?, ?, ?)', [customerId, total, paymentMethod]);
        const saleId = saleResult.changes.lastId;

        // Insert sale items and update stock
        for (const item of cart) {
            await db.run('INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES (?, ?, ?, ?)', [saleId, item.productId, item.quantity, item.price]);
            await db.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.productId]);
        }

        await db.run('COMMIT;');
        alert('Sale completed!');
        // Generate receipt
        generateReceipt(saleId);
        cart = [];
        renderCart();
        // Reload product dropdown
        loadProductsForSelect();
    } catch (error) {
        await db.run('ROLLBACK;');
        console.error('Checkout failed', error);
        alert('Checkout failed');
    }
}

// -------------------- Reports --------------------
function renderReports(container) {
    container.innerHTML = `
        <div class="card">
            <h3>Sales Report</h3>
            <div class="form-group">
                <label>From</label>
                <input type="date" id="reportFrom" value="${new Date().toISOString().slice(0,10)}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" id="reportTo" value="${new Date().toISOString().slice(0,10)}">
            </div>
            <button id="generateReportBtn">Generate</button>
            <button id="exportCsvBtn">Export CSV</button>
        </div>
        <div id="reportResult" class="card"></div>
    `;

    document.getElementById('generateReportBtn').addEventListener('click', generateReport);
    document.getElementById('exportCsvBtn').addEventListener('click', () => {
        const from = document.getElementById('reportFrom').value;
        const to = document.getElementById('reportTo').value;
        exportSalesToCSV(from, to);
    });
}

async function generateReport() {
    const from = document.getElementById('reportFrom').value;
    const to = document.getElementById('reportTo').value;
    const result = await db.query(`
        SELECT s.id, s.total, s.payment_method, s.created_at, c.name as customer
        FROM sales s
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE date(s.created_at) BETWEEN date(?) AND date(?)
        ORDER BY s.created_at DESC
    `, [from, to]);

    let html = '<h4>Sales List</h4>';
    let total = 0;
    result.values.forEach(s => {
        total += s.total;
        html += `
            <div class="list-item">
                <div>
                    #${s.id} - ${new Date(s.created_at).toLocaleDateString()}<br>
                    Customer: ${s.customer || 'Walk-in'}<br>
                    Payment: ${s.payment_method}
                </div>
                <div>$${s.total.toFixed(2)}</div>
            </div>
        `;
    });
    html += `<h3>Total: $${total.toFixed(2)}</h3>`;
    document.getElementById('reportResult').innerHTML = html;
}

// -------------------- Settings --------------------
function renderSettings(container) {
    const settings = JSON.parse(localStorage.getItem('businessSettings') || '{}');
    container.innerHTML = `
        <div class="card">
            <h3>Business Information</h3>
            <div class="form-group">
                <label>Business Name</label>
                <input id="businessName" value="${settings.name || ''}">
            </div>
            <div class="form-group">
                <label>Address</label>
                <textarea id="businessAddress">${settings.address || ''}</textarea>
            </div>
            <div class="form-group">
                <label>Phone</label>
                <input id="businessPhone" value="${settings.phone || ''}">
            </div>
            <div class="form-group">
                <label>Email</label>
                <input id="businessEmail" value="${settings.email || ''}">
            </div>
            <div class="form-group">
                <label>Receipt Footer</label>
                <input id="receiptFooter" value="${settings.receiptFooter || ''}">
            </div>
            <button id="saveSettingsBtn">Save Settings</button>
        </div>
        <div class="card">
            <h3>Backup & Restore</h3>
            <button id="backupBtn">Backup Database</button>
            <button id="restoreBtn">Restore Database</button>
        </div>
    `;

    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
        const settings = {
            name: document.getElementById('businessName').value,
            address: document.getElementById('businessAddress').value,
            phone: document.getElementById('businessPhone').value,
            email: document.getElementById('businessEmail').value,
            receiptFooter: document.getElementById('receiptFooter').value,
        };
        localStorage.setItem('businessSettings', JSON.stringify(settings));
        alert('Settings saved');
    });

    document.getElementById('backupBtn').addEventListener('click', backupDatabase);
    document.getElementById('restoreBtn').addEventListener('click', async () => {
        const fileName = await pickBackupFile();
        if (fileName) await restoreDatabase(fileName);
    });
}
