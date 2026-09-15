require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const path = require("path");
const db = require("./db");
const {
  COOKIE_NAME, findUserByUsername, countUsers, verifyPassword, issueToken, requireAuth,
} = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

/* ---------------------------------------------------------
   AUTH
--------------------------------------------------------- */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak percobaan login. Coba lagi beberapa menit lagi." },
});

app.post("/api/auth/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username dan password wajib diisi." });
  }
  if (countUsers() === 0) {
    return res.status(503).json({
      error: "Belum ada akun admin. Jalankan 'npm run create-admin' di server terlebih dahulu.",
    });
  }
  const user = findUserByUsername(username);
  // Generic error message on purpose: never reveal whether the username exists.
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
  logAudit(user.name, "Login ke sistem");
  res.json({ name: user.name, username: user.username });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  logAudit(req.user.name, "Logout dari sistem");
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ name: req.user.name, username: req.user.username });
});

/* All routes below require a valid session */
app.use("/api", requireAuth);

function logAudit(user, action) {
  db.prepare("INSERT INTO audit_log (time, user, action) VALUES (?,?,?)").run(Date.now(), user, action);
}

/* ---------------------------------------------------------
   MENU (permanent CRUD)
--------------------------------------------------------- */
app.get("/api/menu", (req, res) => {
  res.json(db.prepare("SELECT * FROM menu_items").all());
});

app.post("/api/menu", (req, res) => {
  const { name, category, price, inventoryId, uses } = req.body || {};
  if (!name || typeof price !== "number" || price < 0) {
    return res.status(400).json({ error: "Nama menu dan harga (angka >= 0) wajib diisi." });
  }
  const id = "m_" + Date.now();
  db.prepare("INSERT INTO menu_items (id,name,category,price,inventory_id,uses) VALUES (?,?,?,?,?,?)").run(
    id, name, category || "Lainnya", price, inventoryId || null, uses || 1
  );
  logAudit(req.user.name, `Menambahkan menu baru "${name}"`);
  res.status(201).json(db.prepare("SELECT * FROM menu_items WHERE id = ?").get(id));
});

app.put("/api/menu/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Menu tidak ditemukan." });
  const { name, category, price, inventoryId, uses } = req.body || {};
  if (!name || typeof price !== "number" || price < 0) {
    return res.status(400).json({ error: "Nama menu dan harga (angka >= 0) wajib diisi." });
  }
  db.prepare("UPDATE menu_items SET name=?, category=?, price=?, inventory_id=?, uses=? WHERE id=?").run(
    name, category || "Lainnya", price, inventoryId || null, uses || 1, req.params.id
  );
  logAudit(req.user.name, `Mengubah menu "${name}"`);
  res.json(db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id));
});

app.delete("/api/menu/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Menu tidak ditemukan." });
  db.prepare("DELETE FROM menu_items WHERE id = ?").run(req.params.id);
  logAudit(req.user.name, `Menghapus menu "${existing.name}" secara permanen`);
  res.json({ ok: true });
});

/* ---------------------------------------------------------
   INVENTORY
--------------------------------------------------------- */
app.get("/api/inventory", (req, res) => {
  res.json(db.prepare("SELECT * FROM inventory").all());
});

app.patch("/api/inventory/:id", (req, res) => {
  const inv = db.prepare("SELECT * FROM inventory WHERE id = ?").get(req.params.id);
  if (!inv) return res.status(404).json({ error: "Item inventaris tidak ditemukan." });
  const { delta } = req.body || {};
  if (typeof delta !== "number") return res.status(400).json({ error: "'delta' harus berupa angka." });
  const newStock = Math.max(0, inv.stock + delta);
  db.prepare("UPDATE inventory SET stock = ? WHERE id = ?").run(newStock, req.params.id);
  logAudit(req.user.name, `Mengubah stok "${inv.name}" sebesar ${delta > 0 ? "+" : ""}${delta}`);
  res.json(db.prepare("SELECT * FROM inventory WHERE id = ?").get(req.params.id));
});

/* ---------------------------------------------------------
   CUSTOMERS
--------------------------------------------------------- */
app.get("/api/customers", (req, res) => {
  res.json(db.prepare("SELECT * FROM customers").all());
});

app.post("/api/customers", (req, res) => {
  const { name, phone } = req.body || {};
  if (!name) return res.status(400).json({ error: "Nama pelanggan wajib diisi." });
  const id = "c_" + Date.now();
  db.prepare("INSERT INTO customers (id,name,phone,total_orders,total_spent,points) VALUES (?,?,?,0,0,0)").run(
    id, name, phone || ""
  );
  logAudit(req.user.name, `Menambahkan pelanggan baru "${name}"`);
  res.status(201).json(db.prepare("SELECT * FROM customers WHERE id = ?").get(id));
});

/* ---------------------------------------------------------
   PROMOS
--------------------------------------------------------- */
app.get("/api/promos", (req, res) => {
  res.json(db.prepare("SELECT * FROM promos").all());
});

app.patch("/api/promos/:id/toggle", (req, res) => {
  const promo = db.prepare("SELECT * FROM promos WHERE id = ?").get(req.params.id);
  if (!promo) return res.status(404).json({ error: "Promo tidak ditemukan." });
  const newActive = promo.active ? 0 : 1;
  db.prepare("UPDATE promos SET active = ? WHERE id = ?").run(newActive, req.params.id);
  logAudit(req.user.name, `${newActive ? "Mengaktifkan" : "Menonaktifkan"} promo "${promo.name}"`);
  res.json(db.prepare("SELECT * FROM promos WHERE id = ?").get(req.params.id));
});

/* ---------------------------------------------------------
   ORDERS  (atomic: validate stock -> deduct -> create order -> update customer)
--------------------------------------------------------- */
app.get("/api/orders", (req, res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  res.json(rows.map((o) => ({ ...o, items: JSON.parse(o.items_json) })));
});

app.post("/api/orders", (req, res) => {
  const { items, customerId, table, paymentMethod, cash, promoId } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Keranjang tidak boleh kosong." });
  }

  try {
    const result = db.transaction(() => {
      let subtotal = 0;
      const menuCache = {};
      for (const item of items) {
        const menu = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(item.menuId);
        if (!menu) throw new Error(`Menu dengan id ${item.menuId} tidak ditemukan.`);
        menuCache[item.menuId] = menu;
        subtotal += menu.price * item.qty;

        if (menu.inventory_id) {
          const inv = db.prepare("SELECT * FROM inventory WHERE id = ?").get(menu.inventory_id);
          if (!inv || inv.stock < item.qty * menu.uses) {
            const err = new Error(`Stok "${menu.name}" tidak mencukupi (tersisa ${inv ? inv.stock : 0}).`);
            err.code = "STOCK";
            throw err;
          }
        }
      }

      let promo = null;
      if (promoId) {
        promo = db.prepare("SELECT * FROM promos WHERE id = ? AND active = 1").get(promoId);
      }
      const discount = promo ? Math.round(subtotal * (promo.discount / 100)) : 0;
      const total = subtotal - discount;

      if (paymentMethod === "Tunai" && (typeof cash !== "number" || cash < total)) {
        const err = new Error("Uang tunai yang diterima kurang dari total pesanan.");
        err.code = "CASH";
        throw err;
      }
      const change = paymentMethod === "Tunai" ? cash - total : 0;

      // Deduct stock
      for (const item of items) {
        const menu = menuCache[item.menuId];
        if (menu.inventory_id) {
          db.prepare("UPDATE inventory SET stock = stock - ? WHERE id = ?").run(
            item.qty * menu.uses, menu.inventory_id
          );
        }
      }

      const id = "ord_" + Date.now();
      db.prepare(`INSERT INTO orders
        (id,items_json,customer_id,table_no,payment_method,cash,change_amount,subtotal,discount,total,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'Diproses',?)`).run(
        id, JSON.stringify(items), customerId || null, table || null,
        paymentMethod || "Tunai", cash || total, change, subtotal, discount, total, Date.now()
      );

      if (customerId) {
        db.prepare(
          "UPDATE customers SET total_orders = total_orders + 1, total_spent = total_spent + ?, points = points + ? WHERE id = ?"
        ).run(total, Math.floor(total / 1000), customerId);
      }

      logAudit(req.user.name, `Membuat pesanan #${id.slice(-5)} senilai Rp${Math.round(total).toLocaleString("id-ID")}`);
      return db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    })();

    res.status(201).json({ ...result, items: JSON.parse(result.items_json) });
  } catch (e) {
    const status = e.code === "STOCK" || e.code === "CASH" ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

app.patch("/api/orders/:id/cancel", (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
  if (order.status === "Dibatalkan") return res.status(400).json({ error: "Pesanan sudah dibatalkan sebelumnya." });

  const result = db.transaction(() => {
    const items = JSON.parse(order.items_json);
    items.forEach((item) => {
      const menu = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(item.menuId);
      if (menu && menu.inventory_id) {
        db.prepare("UPDATE inventory SET stock = stock + ? WHERE id = ?").run(
          item.qty * menu.uses, menu.inventory_id
        );
      }
    });
    if (order.customer_id) {
      db.prepare(
        "UPDATE customers SET total_orders = MAX(0, total_orders - 1), total_spent = MAX(0, total_spent - ?), points = MAX(0, points - ?) WHERE id = ?"
      ).run(order.total, Math.floor(order.total / 1000), order.customer_id);
    }
    db.prepare("UPDATE orders SET status = 'Dibatalkan' WHERE id = ?").run(order.id);
    logAudit(req.user.name, `Membatalkan pesanan #${order.id.slice(-5)}`);
    return db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
  })();

  res.json({ ...result, items: JSON.parse(result.items_json) });
});

/* ---------------------------------------------------------
   AUDIT LOG
--------------------------------------------------------- */
app.get("/api/audit", (req, res) => {
  res.json(db.prepare("SELECT * FROM audit_log ORDER BY time DESC LIMIT 300").all());
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
  app.listen(PORT, () => {
    console.log(`HokPOS backend berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;
