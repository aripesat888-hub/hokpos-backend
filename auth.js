const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const COOKIE_NAME = "hokpos_token";
const TOKEN_TTL = "12h";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "JWT_SECRET belum diset atau terlalu pendek. Buat file .env berisi JWT_SECRET=<string acak panjang> sebelum menjalankan server."
    );
  }
  return secret;
}

function findUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

function countUsers() {
  return db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
}

function createOrUpdateAdmin(username, plainPassword, name) {
  const hash = bcrypt.hashSync(plainPassword, 12);
  const existing = db.prepare("SELECT id FROM users LIMIT 1").get();
  if (existing) {
    db.prepare("UPDATE users SET username = ?, password_hash = ?, name = ? WHERE id = ?").run(
      username, hash, name, existing.id
    );
  } else {
    db.prepare("INSERT INTO users (username, password_hash, name, created_at) VALUES (?,?,?,?)").run(
      username, hash, name, Date.now()
    );
  }
}

function verifyPassword(plainPassword, hash) {
  return bcrypt.compareSync(plainPassword, hash);
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, name: user.name }, getJwtSecret(), {
    expiresIn: TOKEN_TTL,
  });
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

function requireAuth(req, res, next) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) return res.status(401).json({ error: "Belum masuk. Silakan login." });
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Sesi tidak valid atau kedaluwarsa. Silakan login kembali." });
  }
}

module.exports = {
  COOKIE_NAME,
  findUserByUsername,
  countUsers,
  createOrUpdateAdmin,
  verifyPassword,
  issueToken,
  verifyToken,
  requireAuth,
};
