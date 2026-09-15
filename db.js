const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "hokpos.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  inventory_id TEXT,
  uses REAL NOT NULL DEFAULT 1,
  FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_spent REAL NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS promos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  discount REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  items_json TEXT NOT NULL,
  customer_id TEXT,
  table_no TEXT,
  payment_method TEXT NOT NULL,
  cash REAL NOT NULL DEFAULT 0,
  change_amount REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Diproses',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time INTEGER NOT NULL,
  user TEXT NOT NULL,
  action TEXT NOT NULL
);
`);

// Seed default data only if tables are empty (first run)
function seedIfEmpty() {
  const invCount = db.prepare("SELECT COUNT(*) AS c FROM inventory").get().c;
  if (invCount === 0) {
    const insInv = db.prepare("INSERT INTO inventory (id,name,unit,stock,min_stock) VALUES (?,?,?,?,?)");
    const seedInv = [
      ["inv1", "Ayam Katsu", "porsi", 24, 10],
      ["inv2", "Nasi", "porsi", 60, 20],
      ["inv3", "Udang Tempura", "porsi", 8, 10],
      ["inv4", "Chicken Teriyaki", "porsi", 30, 12],
      ["inv5", "Ocha", "botol", 40, 15],
      ["inv6", "Gyoza", "porsi", 3, 10],
    ];
    const tx = db.transaction((rows) => rows.forEach((r) => insInv.run(...r)));
    tx(seedInv);

    const insMenu = db.prepare("INSERT INTO menu_items (id,name,category,price,inventory_id,uses) VALUES (?,?,?,?,?,?)");
    const seedMenu = [
      ["m1", "Chicken Katsu Bento", "Bento", 28000, "inv1", 1],
      ["m2", "Nasi Putih", "Tambahan", 6000, "inv2", 1],
      ["m3", "Ebi Tempura Bento", "Bento", 32000, "inv3", 1],
      ["m4", "Chicken Teriyaki Bento", "Bento", 27000, "inv4", 1],
      ["m5", "Ocha Dingin", "Minuman", 8000, "inv5", 1],
      ["m6", "Gyoza (5pcs)", "Snack", 15000, "inv6", 1],
    ];
    const tx2 = db.transaction((rows) => rows.forEach((r) => insMenu.run(...r)));
    tx2(seedMenu);

    const insPromo = db.prepare("INSERT INTO promos (id,name,discount,active) VALUES (?,?,?,?)");
    insPromo.run("p1", "Diskon Jam Makan Siang", 10, 1);
    insPromo.run("p2", "Promo Member Baru", 15, 0);

    const insCust = db.prepare("INSERT INTO customers (id,name,phone,total_orders,total_spent,points) VALUES (?,?,?,0,0,0)");
    insCust.run("c1", "Rina Wijaya", "0812-3456-7890");
    insCust.run("c2", "Budi Santoso", "0813-1122-3344");
  }
}
seedIfEmpty();

module.exports = db;
