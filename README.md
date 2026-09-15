# HokPOS Backend — Versi Asli (Self-hosted)

Backend nyata untuk HokPOS: Node.js + Express + SQLite, dengan login admin
tunggal yang aman dan penyimpanan **permanen** untuk semua transaksi, menu,
stok, pelanggan, promo, dan log aktivitas.

## Yang berbeda dari versi sebelumnya
- **Database sungguhan (SQLite)** — semua perubahan (transaksi, tambah/edit/hapus
  menu, ubah stok) langsung ditulis ke file database dan tetap ada walau
  server dimatikan lalu dinyalakan lagi.
- **Login aman** — hanya satu akun admin. Password **tidak pernah** disimpan
  sebagai teks biasa; hanya hash bcrypt yang masuk ke database. Sesi login
  memakai token JWT yang disimpan di cookie `httpOnly` (tidak bisa dibaca lewat
  JavaScript di browser, termasuk lewat F12/console) sehingga password dan
  token tidak bisa dilihat siapa pun yang membuka halaman tersebut.
- **Percobaan login dibatasi** (rate limit) untuk mencegah tebak-tebak password.
- **Pesan error login generik** — sengaja tidak membedakan "username salah"
  dan "password salah", supaya orang tidak bisa menebak username yang valid.

## Persyaratan
- [Node.js](https://nodejs.org) versi 18 ke atas terpasang di komputer/server Anda.

## Langkah Menjalankan (Lokal)

```bash
# 1. Masuk ke folder ini
cd hokpos-backend

# 2. Install semua dependensi
npm install

# 3. Salin file konfigurasi lalu ISI SENDIRI nilainya
cp .env.example .env
```

Buka file `.env` yang baru dibuat, lalu ganti `JWT_SECRET` dengan string acak
panjang milik Anda sendiri. Cara membuatnya:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Salin hasilnya ke dalam `.env`.

```bash
# 4. Buat akun admin (password Anda akan diminta dan disembunyikan saat mengetik)
npm run create-admin

# 5. Jalankan server
npm start
```

Buka browser ke **http://localhost:3000** dan login dengan akun admin yang
baru dibuat.

## Struktur Data (permanen, tersimpan di `data/hokpos.db`)
- `menu_items` — menu, harga, kategori, keterkaitan ke stok
- `inventory` — stok bahan/menu
- `orders` — semua transaksi (termasuk yang dibatalkan, statusnya diubah bukan dihapus)
- `customers` — data & riwayat pelanggan
- `promos` — daftar promo aktif/nonaktif
- `audit_log` — jejak semua aksi penting beserta waktunya
- `users` — satu akun admin (hanya hash password, tidak pernah teks biasa)

Semua tabel ini adalah file SQLite biasa (`data/hokpos.db`) — **backup rutin
file ini** untuk mengamankan data Anda (misalnya salin ke Google Drive setiap hari).

## Mengubah Password Admin
Jalankan lagi `npm run create-admin` kapan saja — ini akan menimpa akun admin
yang ada dengan username/password baru yang Anda masukkan.

## Supaya Bisa Diakses dari Internet (opsional)
Server ini secara default hanya bisa diakses dari komputer tempat ia
dijalankan (`localhost`). Untuk membuatnya bisa diakses staf dari perangkat
lain atau dari luar, Anda perlu meng-hosting-nya. Pilihan termudah:

1. **Railway.app / Render.com** — hubungkan repository ini, set environment
   variable `JWT_SECRET`, deploy. Lalu jalankan `npm run create-admin` lewat
   fitur "shell"/"console" yang disediakan platform tersebut.
2. **VPS sendiri** (DigitalOcean, dsb.) — install Node.js, jalankan langkah di
   atas, lalu gunakan `pm2` atau `systemd` agar server tetap berjalan, dan
   pasang Nginx + SSL (Let's Encrypt) di depannya supaya aman (HTTPS) dan set
   `NODE_ENV=production` di `.env` agar cookie sesi memaksa HTTPS.

**Penting:** jangan pernah membagikan file `.env` Anda (berisi `JWT_SECRET`)
ke siapa pun atau mengunggahnya ke repository publik.

## Keterbatasan yang perlu diketahui
- Ini backend single-admin, single-instance. Untuk banyak kasir/peran
  berbeda atau multi-cabang, strukturnya perlu diperluas lagi (bisa saya
  bantu kapan saja jika dibutuhkan).
- Tidak ada pembatasan akses jaringan bawaan (firewall) — kalau di-deploy ke
  internet publik, pastikan mengaktifkan HTTPS (`NODE_ENV=production`) agar
  cookie sesi terkirim terenkripsi.
