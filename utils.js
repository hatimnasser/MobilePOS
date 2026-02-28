import { getDB } from './db.js';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// -------------------- PDF Receipt --------------------
export async function generateReceipt(saleId) {
    const db = getDB();
    // Fetch sale details with customer and items
    const sale = await db.query(`
        SELECT s.*, c.name as customer_name, c.phone, c.email 
        FROM sales s 
        LEFT JOIN customers c ON s.customer_id = c.id 
        WHERE s.id = ?
    `, [saleId]);
    const items = await db.query(`
        SELECT p.name, si.quantity, si.price 
        FROM sale_items si 
        JOIN products p ON si.product_id = p.id 
        WHERE si.sale_id = ?
    `, [saleId]);

    if (!sale.values.length) return;

    const saleData = sale.values[0];
    const business = JSON.parse(localStorage.getItem('businessSettings') || '{}');

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(business.name || 'Your Business', 20, 20);
    doc.setFontSize(10);
    doc.text(business.address || '', 20, 30);
    doc.text(`Phone: ${business.phone || ''}`, 20, 35);
    doc.text(`Email: ${business.email || ''}`, 20, 40);
    doc.text(`Receipt #: ${saleData.id}`, 20, 50);
    doc.text(`Date: ${new Date(saleData.created_at).toLocaleString()}`, 20, 55);
    if (saleData.customer_name) {
        doc.text(`Customer: ${saleData.customer_name}`, 20, 60);
    }
    doc.text(`Payment: ${saleData.payment_method || 'Cash'}`, 20, 65);

    // Table
    const tableColumn = ["Item", "Qty", "Price", "Total"];
    const tableRows = items.values.map(item => [
        item.name,
        item.quantity,
        `$${item.price.toFixed(2)}`,
        `$${(item.quantity * item.price).toFixed(2)}`
    ]);
    doc.autoTable({
        startY: 70,
        head: [tableColumn],
        body: tableRows,
        foot: [['', '', 'Total', `$${saleData.total.toFixed(2)}`]],
    });

    // Footer
    doc.text(business.receiptFooter || 'Thank you for your business!', 20, doc.lastAutoTable.finalY + 20);

    // Save PDF
    const pdfOutput = doc.output('datauristring');
    const fileName = `receipt_${saleId}.pdf`;
    const result = await Filesystem.writeFile({
        path: fileName,
        data: pdfOutput.split(',')[1],
        directory: Directory.Cache,
    });
    // Share
    await Share.share({
        title: 'Receipt',
        text: 'Receipt PDF',
        url: result.uri,
        dialogTitle: 'Share Receipt',
    });
}

// -------------------- CSV Export --------------------
export async function exportSalesToCSV(startDate, endDate) {
    const db = getDB();
    const sales = await db.query(`
        SELECT s.id, s.total, s.payment_method, s.created_at, c.name as customer
        FROM sales s
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE date(s.created_at) BETWEEN date(?) AND date(?)
    `, [startDate, endDate]);

    if (!sales.values.length) {
        alert('No sales in this period');
        return;
    }

    let csv = 'ID,Total,Payment Method,Customer,Date\n';
    sales.values.forEach(s => {
        csv += `${s.id},${s.total},${s.payment_method},${s.customer || ''},${s.created_at}\n`;
    });

    const fileName = `sales_${startDate}_to_${endDate}.csv`;
    const result = await Filesystem.writeFile({
        path: fileName,
        data: csv,
        directory: Directory.Cache,
    });
    await Share.share({
        title: 'Sales Report',
        text: 'Sales CSV',
        url: result.uri,
        dialogTitle: 'Share CSV',
    });
}

// -------------------- Backup & Restore (JSON) --------------------
export async function backupDatabase() {
    const db = getDB();
    // Export all tables to JSON
    const tables = ['products', 'customers', 'sales', 'sale_items'];
    const backupData = {};
    for (const table of tables) {
        const res = await db.query(`SELECT * FROM ${table}`);
        backupData[table] = res.values;
    }
    // Add settings from localStorage
    backupData.settings = JSON.parse(localStorage.getItem('businessSettings') || '{}');

    const jsonString = JSON.stringify(backupData, null, 2);
    const fileName = `pos_backup_${new Date().toISOString().slice(0,10)}.json`;
    const result = await Filesystem.writeFile({
        path: fileName,
        data: jsonString,
        directory: Directory.Cache,
    });
    await Share.share({
        title: 'Backup',
        text: 'Database backup JSON',
        url: result.uri,
        dialogTitle: 'Share Backup',
    });
}

export async function restoreDatabase(uri) {
    // Read file content
    const contents = await Filesystem.readFile({ path: uri, directory: Directory.Cache });
    const backupData = JSON.parse(contents.data);

    const db = getDB();
    // Clear existing tables
    await db.execute('DELETE FROM sale_items');
    await db.execute('DELETE FROM sales');
    await db.execute('DELETE FROM products');
    await db.execute('DELETE FROM customers');

    // Insert data back
    for (const table of ['products', 'customers', 'sales', 'sale_items']) {
        const rows = backupData[table];
        if (rows && rows.length) {
            // Simple insert – assumes columns match. For production, map columns.
            for (const row of rows) {
                const columns = Object.keys(row).join(', ');
                const placeholders = Object.keys(row).map(() => '?').join(', ');
                const values = Object.values(row);
                await db.run(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`, values);
            }
        }
    }
    // Restore settings
    if (backupData.settings) {
        localStorage.setItem('businessSettings', JSON.stringify(backupData.settings));
    }
    alert('Restore complete! Reloading app...');
    window.location.reload();
}

// Helper to pick file (for restore)
import { Capacitor } from '@capacitor/core';
export async function pickBackupFile() {
    // Use file picker via input (web only, but works in Capacitor with permissions)
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = async (e) => {
                // Write to cache to get a URI
                const fileName = 'restore_temp.json';
                await Filesystem.writeFile({
                    path: fileName,
                    data: e.target.result,
                    directory: Directory.Cache,
                });
                resolve(fileName);
            };
            reader.readAsText(file);
        };
        input.click();
    });
}