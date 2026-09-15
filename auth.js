const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { run, get } = require("./db");

const COOKIE_NAME = "hokpos_token";
const TOKEN_TTL = "12h";
const SECRET_FILE = path.join(__dirname, "data", ".jwt_secret");

function getJwtSecret() {
  let secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  // No secret configured - auto-generate one and persist it locally so
  // sessions survive restarts without requiring manual setup. Note: on hosts
  // with an ephemeral filesystem this file will be regenerated on redeploy,
  // which simply logs everyone out (not a data-loss issue, since real data
  // lives in the database, not here).
  try {
    if (fs.existsSync(SECRET_FILE)) {
      return fs.readFileSync(SECRET_FILE, "utf8").trim();
    }
  } catch (e) { /* fall through to generate */ }
  const crypto = require("crypto");
  secret = crypto.randomBytes(48).toString("hex");
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  } catch (e) {
    console.warn("Tidak bisa menyimpan JWT secret ke disk, sesi akan reset saat server direstart.");
  }
  return secret;
}

async function findUserByUsername(username) {
  return get("SELECT * FROM users WHERE username = ?", [username]);
}

async function countUsers() {
  const row = await get("SELECT COUNT(*) AS c FROM users");
  return row.c;
}

async function createOrUpdateAdmin(username, plainPassword, name) {
  const hash = bcrypt.hashSync(plainPassword, 12);
  const existing = await get("SELECT id FROM users LIMIT 1");
  if (existing) {
    await run("UPDATE users SET username = ?, password_hash = ?, name = ? WHERE id = ?", [
      username, hash, name, existing.id,
    ]);
  } else {
    await run("INSERT INTO users (username, password_hash, name, created_at) VALUES (?,?,?,?)", [
      username, hash, name, Date.now(),
    ]);
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
