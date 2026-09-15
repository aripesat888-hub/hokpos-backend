/**
 * Membuat / mengubah akun admin tunggal untuk HokPOS.
 * Password TIDAK PERNAH disimpan sebagai teks biasa - hanya hash bcrypt yang
 * masuk ke database. Jalankan: npm run create-admin
 */
require("dotenv").config();
const readline = require("readline");
const { createOrUpdateAdmin } = require("../auth");
const dbLayer = require("../db");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden) {
      rl.question(question, resolve);
      return;
    }
    // Sembunyikan input password di terminal
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (char) => {
      char = char.toString();
      if (char === "\n" || char === "\r" || char === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (char === "\u0003") {
        process.exit(1);
      } else if (char === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

(async () => {
  console.log("=== Setup Akun Admin HokPOS ===");
  const username = (await ask("Username admin: ")).trim() || "admin";
  const name = (await ask("Nama tampilan (contoh: Admin Utama): ")).trim() || "Admin Utama";
  const password = (await ask("Password admin (tersembunyi): ", true)).trim();
  rl.close();

  if (password.length < 8) {
    console.error("\nPassword minimal 8 karakter. Jalankan ulang perintah ini.");
    process.exit(1);
  }

  await dbLayer.ready();
  createOrUpdateAdmin(username, password, name).then(() => {
    console.log(`\nAkun admin "${username}" berhasil disimpan. Password disimpan sebagai hash bcrypt, tidak pernah dalam bentuk teks biasa.`);
    process.exit(0);
  });
})();
