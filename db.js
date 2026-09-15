const { createClient } = require("@libsql/client");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "data");

// If TURSO_DATABASE_URL is set, data is stored permanently in a free Turso
// cloud database (needed on hosts like Render's free tier or Netlify
// Functions, whose local disk is either wiped or entirely read-only).
// Otherwise it falls back to a local file, which works great for trying
// things out on your own computer.
const usingTurso = !!process.env.TURSO_DATABASE_URL;

if (!usingTurso) {
  // Only touch the local filesystem when we actually need a local file -
  // on read-only hosts (like Netlify Functions) this is skipped entirely.
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.warn("Tidak bisa membuat folder data lokal (filesystem read-only?). Set TURSO_DATABASE_URL untuk memakai database cloud.");
  }
}

const url = usingTurso ? process.env.TURSO_DATABASE_URL : `file:${path.join(DATA_DIR, "hokpos.db")}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const db = createClient(usingTurso ? { url, authToken } : { url });

async function run(sql, args = []) {
  return db.execute({ sql, args });
}
async function get(sql, args = []) {
  const res = await db.execute({ sql, args });
  return res.rows[0] || null;
}
async function all(sql, args = []) {
  const res = await db.execute({ sql, args });
  return res.rows;
}

async function initSchema() {
  await db.executeMultiple(`
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
      image_url TEXT
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
      source TEXT NOT NULL DEFAULT 'pos',
      customer_name TEXT,
      customer_phone TEXT,
      payment_status TEXT NOT NULL DEFAULT 'Lunas',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time INTEGER NOT NULL,
      user TEXT NOT NULL,
      action TEXT NOT NULL
    );
  `);

  // Lightweight migration for databases created before these columns existed.
  // Each ADD COLUMN is attempted individually; "duplicate column" errors are
  // expected (and safely ignored) on databases that already have them.
  const migrations = [
    "ALTER TABLE menu_items ADD COLUMN image_url TEXT",
    "ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'pos'",
    "ALTER TABLE orders ADD COLUMN customer_name TEXT",
    "ALTER TABLE orders ADD COLUMN customer_phone TEXT",
    "ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'Lunas'",
    "ALTER TABLE orders ADD COLUMN notes TEXT",
  ];
  for (const stmt of migrations) {
    try {
      await db.execute(stmt);
    } catch (e) {
      // Column already exists - fine, nothing to do.
    }
  }
}

async function seedIfEmpty() {
  const invCountRow = await get("SELECT COUNT(*) AS c FROM inventory");
  if (invCountRow.c === 0) {
    const seedInv = [
      ["inv1", "Ayam Katsu", "porsi", 24, 10],
      ["inv2", "Nasi", "porsi", 60, 20],
      ["inv3", "Udang Tempura", "porsi", 8, 10],
      ["inv4", "Chicken Teriyaki", "porsi", 30, 12],
      ["inv5", "Ocha", "botol", 40, 15],
      ["inv6", "Gyoza", "porsi", 3, 10],
    ];
    for (const row of seedInv) {
      await run("INSERT INTO inventory (id,name,unit,stock,min_stock) VALUES (?,?,?,?,?)", row);
    }

    const seedMenu = [
      ["m1", "Chicken Katsu Bento", "Bento", 28000, "inv1", 1, "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=500"],
      ["m2", "Nasi Putih", "Tambahan", 6000, "inv2", 1, "https://images.unsplash.com/photo-1516684732162-798a0062be99?w=500"],
      ["m3", "Ebi Tempura Bento", "Bento", 32000, "inv3", 1, "https://images.unsplash.com/photo-1615361200141-f45961bc0e0d?w=500"],
      ["m4", "Chicken Teriyaki Bento", "Bento", 27000, "inv4", 1, "https://images.unsplash.com/photo-1569058242567-93de6f36f8e6?w=500"],
      ["m5", "Ocha Dingin", "Minuman", 8000, "inv5", 1, "https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500"],
      ["m6", "Gyoza (5pcs)", "Snack", 15000, "inv6", 1, "https://images.unsplash.com/photo-1626804475297-41608ea09aeb?w=500"],
    ];
    for (const row of seedMenu) {
      await run("INSERT INTO menu_items (id,name,category,price,inventory_id,uses,image_url) VALUES (?,?,?,?,?,?,?)", row);
    }

    await run("INSERT INTO promos (id,name,discount,active) VALUES (?,?,?,?)", ["p1", "Diskon Jam Makan Siang", 10, 1]);
    await run("INSERT INTO promos (id,name,discount,active) VALUES (?,?,?,?)", ["p2", "Promo Member Baru", 15, 0]);

    await run("INSERT INTO customers (id,name,phone,total_orders,total_spent,points) VALUES (?,?,?,0,0,0)", ["c1", "Rina Wijaya", "0812-3456-7890"]);
    await run("INSERT INTO customers (id,name,phone,total_orders,total_spent,points) VALUES (?,?,?,0,0,0)", ["c2", "Budi Santoso", "0813-1122-3344"]);
  }

  const settingsCountRow = await get("SELECT COUNT(*) AS c FROM settings");
  if (settingsCountRow.c === 0) {
    const defaults = {
      store_name: "Restoran Anda",
      store_tagline: "Pesan online, kami siapkan segera",
      store_hours: "10:00 - 22:00 WIB",
      store_location: "",
      store_whatsapp: "",
      bank_name: "",
      bank_account_number: "",
      bank_account_name: "",
      qris_image_url: "",
    };
    for (const [key, value] of Object.entries(defaults)) {
      await run("INSERT INTO settings (key, value) VALUES (?,?)", [key, value]);
    }
  }
}

let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initSchema();
      await seedIfEmpty();
    })();
  }
  return readyPromise;
}

module.exports = { db, run, get, all, ready, usingTurso };
