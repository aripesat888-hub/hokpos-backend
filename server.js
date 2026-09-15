require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const path = require("path");
const dbLayer = require("./db");
const { db, run, get, all } = dbLayer;
const {
  COOKIE_NAME, findUserByUsername, countUsers, verifyPassword, issueToken, requireAuth, createOrUpdateAdmin,
} = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

/* Every request waits for the database (schema + seed data) to be ready.
   This only actually delays anything on the very first request after boot. */
app.use(async (req, res, next) => {
  try {
    await dbLayer.ready();
    next();
  } catch (e) {
    console.error("Database belum siap:", e);
    res.status(503).json({ error: "Server sedang mempersiapkan database, coba lagi sebentar." });
  }
});

/* ---------------------------------------------------------
   AUTH
--------------------------------------------------------- */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  // Serverless platforms (e.g. Netlify Functions) don't always populate
  // req.ip the way a normal Node server does. Fall back to a forwarded-for
  // header, then to a constant key, rather than letting the library throw.
  keyGenerator: (req) => {
    const fwd = req.headers && req.headers["x-forwarded-for"];
    if (fwd) return String(fwd).split(",")[0].trim();
    return req.ip || "unknown";
  },
  message: { error: "Terlalu banyak percobaan login. Coba lagi beberapa menit lagi." },
});

// More lenient - this protects the public order form from spam/abuse without
// getting in the way of real customers placing normal orders.
const publicOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const fwd = req.headers && req.headers["x-forwarded-for"];
    if (fwd) return String(fwd).split(",")[0].trim();
    return req.ip || "unknown";
  },
  message: { error: "Terlalu banyak percobaan. Coba lagi beberapa menit lagi." },
});

async function logAudit(user, action) {
  await run("INSERT INTO audit_log (time, user, action) VALUES (?,?,?)", [Date.now(), user, action]);
}

/* ---------------------------------------------------------
   ONE-TIME WEB SETUP (no command line needed)
--------------------------------------------------------- */
app.get("/api/setup/status", async (req, res) => {
  res.json({ alreadySetup: (await countUsers()) > 0 });
});

app.post("/api/setup", loginLimiter, async (req, res) => {
  if ((await countUsers()) > 0) {
    return res.status(403).json({ error: "Akun admin sudah ada. Setup hanya bisa dilakukan sekali." });
  }
  const { username, name, password } = req.body || {};
  if (!username || !name || !password || password.length < 8) {
    return res.status(400).json({ error: "Semua kolom wajib diisi dan password minimal 8 karakter." });
  }
  await createOrUpdateAdmin(username.trim(), password, name.trim());
  await logAudit(name.trim(), "Akun admin dibuat lewat halaman setup web");
  res.status(201).json({ ok: true });
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username dan password wajib diisi." });
  }
  if ((await countUsers()) === 0) {
    return res.status(503).json({ error: "Belum ada akun admin. Buka /setup.html untuk membuatnya." });
  }
  const user = await findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }
  const token = issueToken(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    maxAge: 12 * 60 * 60 * 1000,
  });
  await logAudit(user.name, "Login ke sistem");
  res.json({ name: user.name, username: user.username });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  await logAudit(req.user.name, "Logout dari sistem");
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ name: req.user.name, username: req.user.username });
});

/* ---------------------------------------------------------
   PUBLIC CUSTOMER-FACING ENDPOINTS (no login required)
   These power the public ordering link (public/order.html).
--------------------------------------------------------- */
app.get("/api/public/settings", async (req, res) => {
  const rows = await all("SELECT key, value FROM settings");
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json(settings);
});

app.get("/api/public/menu", async (req, res) => {
  const menu = await all("SELECT * FROM menu_items");
  const inventory = await all("SELECT * FROM inventory");
  const invById = Object.fromEntries(inventory.map((i) => [i.id, i]));
  // Only expose what a customer needs - never raw stock numbers or internal ids.
  const publicMenu = menu.map((m) => {
    const inv = m.inventory_id ? invById[m.inventory_id] : null;
    const available = !inv || inv.stock >= (m.uses || 1);
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      price: m.price,
      imageUrl: m.image_url || null,
      available,
    };
  });
  res.json(publicMenu);
});

app.post("/api/public/orders", publicOrderLimiter, async (req, res) => {
  const { items, customerName, customerPhone, table, paymentMethod, notes } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Keranjang tidak boleh kosong." });
  }
  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: "Nama dan nomor WhatsApp wajib diisi." });
  }
  const validMethods = ["COD", "Transfer", "QRIS"];
  if (!validMethods.includes(paymentMethod)) {
    return res.status(400).json({ error: "Metode pembayaran tidak valid." });
  }

  const tx = await db.transaction("write");
  try {
    let subtotal = 0;
    const menuCache = {};
    for (const item of items) {
      if (!item.menuId || !item.qty || item.qty < 1) {
        throw Object.assign(new Error("Item pesanan tidak valid."), { code: "BAD" });
      }
      const menuRes = await tx.execute({ sql: "SELECT * FROM menu_items WHERE id = ?", args: [item.menuId] });
      const menu = menuRes.rows[0];
      if (!menu) throw Object.assign(new Error(`Menu tidak ditemukan.`), { code: "BAD" });
      menuCache[item.menuId] = menu;
      subtotal += menu.price * item.qty;

      if (menu.inventory_id) {
        const invRes = await tx.execute({ sql: "SELECT * FROM inventory WHERE id = ?", args: [menu.inventory_id] });
        const inv = invRes.rows[0];
        if (!inv || inv.stock < item.qty * menu.uses) {
          throw Object.assign(
            new Error(`Maaf, "${menu.name}" sedang tidak tersedia dalam jumlah yang diminta.`),
            { code: "STOCK" }
          );
        }
      }
    }

    const total = subtotal; // promos are applied by staff at POS only, not on the public form

    for (const item of items) {
      const menu = menuCache[item.menuId];
      if (menu.inventory_id) {
        await tx.execute({
          sql: "UPDATE inventory SET stock = stock - ? WHERE id = ?",
          args: [item.qty * menu.uses, menu.inventory_id],
        });
      }
    }

    const id = "ord_" + Date.now();
    const paymentStatus = paymentMethod === "COD" ? "Bayar di Tempat" : "Menunggu Konfirmasi Pembayaran";
    await tx.execute({
      sql: `INSERT INTO orders
        (id,items_json,customer_id,table_no,payment_method,cash,change_amount,subtotal,discount,total,status,created_at,source,customer_name,customer_phone,payment_status,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,'Menunggu Konfirmasi',?,'online',?,?,?,?)`,
      args: [id, JSON.stringify(items), null, table || null, paymentMethod, 0, 0, subtotal, 0, total,
        Date.now(), customerName.trim(), customerPhone.trim(), paymentStatus, notes || null],
    });

    await tx.execute({
      sql: "INSERT INTO audit_log (time, user, action) VALUES (?,?,?)",
      args: [Date.now(), "Pelanggan (online)", `Pesanan online baru #${id.slice(-5)} dari ${customerName.trim()} senilai Rp${Math.round(total).toLocaleString("id-ID")}`],
    });

    await tx.commit();

    const finalOrder = await get("SELECT * FROM orders WHERE id = ?", [id]);
    res.status(201).json({ ...finalOrder, items: JSON.parse(finalOrder.items_json) });
  } catch (e) {
    await tx.rollback().catch(() => {});
    const status = e.code === "STOCK" || e.code === "BAD" ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

/* All routes below require a valid session */
app.use("/api", requireAuth);

/* ---------------------------------------------------------
   MENU (permanent CRUD)
--------------------------------------------------------- */
app.get("/api/menu", async (req, res) => {
  res.json(await all("SELECT * FROM menu_items"));
});

app.post("/api/menu", async (req, res) => {
  const { name, category, price, inventoryId, uses, imageUrl } = req.body || {};
  if (!name || typeof price !== "number" || price < 0) {
    return res.status(400).json({ error: "Nama menu dan harga (angka >= 0) wajib diisi." });
  }
  const id = "m_" + Date.now();
  await run("INSERT INTO menu_items (id,name,category,price,inventory_id,uses,image_url) VALUES (?,?,?,?,?,?,?)", [
    id, name, category || "Lainnya", price, inventoryId || null, uses || 1, imageUrl || null,
  ]);
  await logAudit(req.user.name, `Menambahkan menu baru "${name}"`);
  res.status(201).json(await get("SELECT * FROM menu_items WHERE id = ?", [id]));
});

app.put("/api/menu/:id", async (req, res) => {
  const existing = await get("SELECT * FROM menu_items WHERE id = ?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Menu tidak ditemukan." });
  const { name, category, price, inventoryId, uses, imageUrl } = req.body || {};
  if (!name || typeof price !== "number" || price < 0) {
    return res.status(400).json({ error: "Nama menu dan harga (angka >= 0) wajib diisi." });
  }
  await run("UPDATE menu_items SET name=?, category=?, price=?, inventory_id=?, uses=?, image_url=? WHERE id=?", [
    name, category || "Lainnya", price, inventoryId || null, uses || 1, imageUrl || null, req.params.id,
  ]);
  await logAudit(req.user.name, `Mengubah menu "${name}"`);
  res.json(await get("SELECT * FROM menu_items WHERE id = ?", [req.params.id]));
});

app.delete("/api/menu/:id", async (req, res) => {
  const existing = await get("SELECT * FROM menu_items WHERE id = ?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Menu tidak ditemukan." });
  await run("DELETE FROM menu_items WHERE id = ?", [req.params.id]);
  await logAudit(req.user.name, `Menghapus menu "${existing.name}" secara permanen`);
  res.json({ ok: true });
});

/* ---------------------------------------------------------
   INVENTORY
--------------------------------------------------------- */
app.get("/api/inventory", async (req, res) => {
  res.json(await all("SELECT * FROM inventory"));
});

app.patch("/api/inventory/:id", async (req, res) => {
  const inv = await get("SELECT * FROM inventory WHERE id = ?", [req.params.id]);
  if (!inv) return res.status(404).json({ error: "Item inventaris tidak ditemukan." });
  const { delta } = req.body || {};
  if (typeof delta !== "number") return res.status(400).json({ error: "'delta' harus berupa angka." });
  const newStock = Math.max(0, inv.stock + delta);
  await run("UPDATE inventory SET stock = ? WHERE id = ?", [newStock, req.params.id]);
  await logAudit(req.user.name, `Mengubah stok "${inv.name}" sebesar ${delta > 0 ? "+" : ""}${delta}`);
  res.json(await get("SELECT * FROM inventory WHERE id = ?", [req.params.id]));
});

/* ---------------------------------------------------------
   CUSTOMERS
--------------------------------------------------------- */
app.get("/api/customers", async (req, res) => {
  res.json(await all("SELECT * FROM customers"));
});

app.post("/api/customers", async (req, res) => {
  const { name, phone } = req.body || {};
  if (!name) return res.status(400).json({ error: "Nama pelanggan wajib diisi." });
  const id = "c_" + Date.now();
  await run("INSERT INTO customers (id,name,phone,total_orders,total_spent,points) VALUES (?,?,?,0,0,0)", [
    id, name, phone || "",
  ]);
  await logAudit(req.user.name, `Menambahkan pelanggan baru "${name}"`);
  res.status(201).json(await get("SELECT * FROM customers WHERE id = ?", [id]));
});

/* ---------------------------------------------------------
   PROMOS
--------------------------------------------------------- */
app.get("/api/promos", async (req, res) => {
  res.json(await all("SELECT * FROM promos"));
});

app.patch("/api/promos/:id/toggle", async (req, res) => {
  const promo = await get("SELECT * FROM promos WHERE id = ?", [req.params.id]);
  if (!promo) return res.status(404).json({ error: "Promo tidak ditemukan." });
  const newActive = promo.active ? 0 : 1;
  await run("UPDATE promos SET active = ? WHERE id = ?", [newActive, req.params.id]);
  await logAudit(req.user.name, `${newActive ? "Mengaktifkan" : "Menonaktifkan"} promo "${promo.name}"`);
  res.json(await get("SELECT * FROM promos WHERE id = ?", [req.params.id]));
});

/* ---------------------------------------------------------
   ORDERS  (atomic via a real DB transaction: validate -> deduct -> insert -> update customer)
--------------------------------------------------------- */
app.get("/api/orders", async (req, res) => {
  const rows = await all("SELECT * FROM orders ORDER BY created_at DESC");
  res.json(rows.map((o) => ({ ...o, items: JSON.parse(o.items_json) })));
});

app.post("/api/orders", async (req, res) => {
  const { items, customerId, table, paymentMethod, cash, promoId } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Keranjang tidak boleh kosong." });
  }

  const tx = await db.transaction("write");
  try {
    let subtotal = 0;
    const menuCache = {};
    for (const item of items) {
      const menuRes = await tx.execute({ sql: "SELECT * FROM menu_items WHERE id = ?", args: [item.menuId] });
      const menu = menuRes.rows[0];
      if (!menu) throw Object.assign(new Error(`Menu dengan id ${item.menuId} tidak ditemukan.`), { code: "BAD" });
      menuCache[item.menuId] = menu;
      subtotal += menu.price * item.qty;

      if (menu.inventory_id) {
        const invRes = await tx.execute({ sql: "SELECT * FROM inventory WHERE id = ?", args: [menu.inventory_id] });
        const inv = invRes.rows[0];
        if (!inv || inv.stock < item.qty * menu.uses) {
          throw Object.assign(
            new Error(`Stok "${menu.name}" tidak mencukupi (tersisa ${inv ? inv.stock : 0}).`),
            { code: "STOCK" }
          );
        }
      }
    }

    let promo = null;
    if (promoId) {
      const promoRes = await tx.execute({ sql: "SELECT * FROM promos WHERE id = ? AND active = 1", args: [promoId] });
      promo = promoRes.rows[0] || null;
    }
    const discount = promo ? Math.round(subtotal * (promo.discount / 100)) : 0;
    const total = subtotal - discount;

    if (paymentMethod === "Tunai" && (typeof cash !== "number" || cash < total)) {
      throw Object.assign(new Error("Uang tunai yang diterima kurang dari total pesanan."), { code: "CASH" });
    }
    const change = paymentMethod === "Tunai" ? cash - total : 0;

    for (const item of items) {
      const menu = menuCache[item.menuId];
      if (menu.inventory_id) {
        await tx.execute({
          sql: "UPDATE inventory SET stock = stock - ? WHERE id = ?",
          args: [item.qty * menu.uses, menu.inventory_id],
        });
      }
    }

    const id = "ord_" + Date.now();
    await tx.execute({
      sql: `INSERT INTO orders
        (id,items_json,customer_id,table_no,payment_method,cash,change_amount,subtotal,discount,total,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'Diproses',?)`,
      args: [id, JSON.stringify(items), customerId || null, table || null, paymentMethod || "Tunai",
        cash || total, change, subtotal, discount, total, Date.now()],
    });

    if (customerId) {
      await tx.execute({
        sql: "UPDATE customers SET total_orders = total_orders + 1, total_spent = total_spent + ?, points = points + ? WHERE id = ?",
        args: [total, Math.floor(total / 1000), customerId],
      });
    }

    await tx.execute({
      sql: "INSERT INTO audit_log (time, user, action) VALUES (?,?,?)",
      args: [Date.now(), req.user.name, `Membuat pesanan #${id.slice(-5)} senilai Rp${Math.round(total).toLocaleString("id-ID")}`],
    });

    await tx.commit();

    const finalOrderRes = await get("SELECT * FROM orders WHERE id = ?", [id]);
    res.status(201).json({ ...finalOrderRes, items: JSON.parse(finalOrderRes.items_json) });
  } catch (e) {
    await tx.rollback().catch(() => {});
    const status = e.code === "STOCK" || e.code === "CASH" || e.code === "BAD" ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

app.patch("/api/orders/:id/status", async (req, res) => {
  const order = await get("SELECT * FROM orders WHERE id = ?", [req.params.id]);
  if (!order) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
  if (order.status === "Dibatalkan") return res.status(400).json({ error: "Pesanan sudah dibatalkan, tidak bisa diubah statusnya." });

  const { status, paymentStatus } = req.body || {};
  const validStatuses = ["Menunggu Konfirmasi", "Diproses", "Selesai"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Status tidak valid." });
  }

  if (paymentStatus) {
    await run("UPDATE orders SET status = ?, payment_status = ? WHERE id = ?", [status, paymentStatus, order.id]);
  } else {
    await run("UPDATE orders SET status = ? WHERE id = ?", [status, order.id]);
  }
  await logAudit(req.user.name, `Mengubah status pesanan #${order.id.slice(-5)} menjadi "${status}"${paymentStatus ? ` (pembayaran: ${paymentStatus})` : ""}`);
  const updated = await get("SELECT * FROM orders WHERE id = ?", [order.id]);
  res.json({ ...updated, items: JSON.parse(updated.items_json) });
});

app.patch("/api/orders/:id/cancel", async (req, res) => {
  const order = await get("SELECT * FROM orders WHERE id = ?", [req.params.id]);
  if (!order) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
  if (order.status === "Dibatalkan") return res.status(400).json({ error: "Pesanan sudah dibatalkan sebelumnya." });

  const tx = await db.transaction("write");
  try {
    const items = JSON.parse(order.items_json);
    for (const item of items) {
      const menuRes = await tx.execute({ sql: "SELECT * FROM menu_items WHERE id = ?", args: [item.menuId] });
      const menu = menuRes.rows[0];
      if (menu && menu.inventory_id) {
        await tx.execute({
          sql: "UPDATE inventory SET stock = stock + ? WHERE id = ?",
          args: [item.qty * menu.uses, menu.inventory_id],
        });
      }
    }
    if (order.customer_id) {
      await tx.execute({
        sql: "UPDATE customers SET total_orders = MAX(0, total_orders - 1), total_spent = MAX(0, total_spent - ?), points = MAX(0, points - ?) WHERE id = ?",
        args: [order.total, Math.floor(order.total / 1000), order.customer_id],
      });
    }
    await tx.execute({ sql: "UPDATE orders SET status = 'Dibatalkan' WHERE id = ?", args: [order.id] });
    await tx.execute({
      sql: "INSERT INTO audit_log (time, user, action) VALUES (?,?,?)",
      args: [Date.now(), req.user.name, `Membatalkan pesanan #${order.id.slice(-5)}`],
    });
    await tx.commit();

    const result = await get("SELECT * FROM orders WHERE id = ?", [order.id]);
    res.json({ ...result, items: JSON.parse(result.items_json) });
  } catch (e) {
    await tx.rollback().catch(() => {});
    res.status(500).json({ error: "Gagal membatalkan pesanan: " + e.message });
  }
});

/* ---------------------------------------------------------
   SETTINGS (store info + payment config used by the public order page)
--------------------------------------------------------- */
app.get("/api/settings", async (req, res) => {
  const rows = await all("SELECT key, value FROM settings");
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

app.put("/api/settings", async (req, res) => {
  const body = req.body || {};
  const allowedKeys = [
    "store_name", "store_tagline", "store_hours", "store_location",
    "store_whatsapp", "bank_name", "bank_account_number", "bank_account_name", "qris_image_url",
  ];
  for (const key of allowedKeys) {
    if (typeof body[key] === "string") {
      await run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, body[key]]
      );
    }
  }
  await logAudit(req.user.name, "Memperbarui pengaturan toko/pembayaran");
  const rows = await all("SELECT key, value FROM settings");
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

/* ---------------------------------------------------------
   AUDIT LOG
--------------------------------------------------------- */
app.get("/api/audit", async (req, res) => {
  res.json(await all("SELECT * FROM audit_log ORDER BY time DESC LIMIT 300"));
});

/* ---------------------------------------------------------
   FALLBACK: serve frontend for any non-API route
--------------------------------------------------------- */
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "Rute tidak ditemukan." });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ---------------------------------------------------------
   ERROR HANDLER (last resort - never leak stack traces)
--------------------------------------------------------- */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Terjadi kesalahan pada server." });
});

if (require.main === module) {
  dbLayer.ready().then(() => {
    app.listen(PORT, () => {
      console.log(`HokPOS backend berjalan di http://localhost:${PORT}`);
      console.log(`Penyimpanan: ${dbLayer.usingTurso ? "Turso cloud (permanen di semua host)" : "file lokal (data/hokpos.db)"}`);
    });
  }).catch((e) => {
    console.error("Gagal menyiapkan database:", e);
    process.exit(1);
  });
}

module.exports = app;
