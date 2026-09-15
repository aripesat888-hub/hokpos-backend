# HokPOS Backend — 100% Gratis, Data Permanen, Tanpa Command Line

Backend nyata untuk HokPOS. Semua transaksi, menu, stok, pelanggan, promo, dan
log aktivitas tersimpan **permanen**. Login admin tunggal, password
ter-enkripsi, sesi aman. **Tidak ada biaya apa pun** di alur di bawah ini.

## Kenapa Tidak Bisa Sekadar "Upload dan Selesai"

Kebanyakan hosting gratis (termasuk opsi "Publish to Live" di GoDaddy yang
kamu coba sebelumnya) mengharuskan bayar begitu ingin link-nya permanen dan
publik. Yang benar-benar gratis selamanya biasanya **menghapus file di
server setiap kali di-restart** — masalah besar untuk aplikasi yang perlu
menyimpan data.

Solusinya: pisahkan **tempat menjalankan aplikasi** (gratis, boleh reset)
dari **tempat menyimpan datanya** (gratis, permanen, tidak pernah reset).
Backend ini sudah saya siapkan untuk itu — datanya disimpan di **Turso**
(database gratis selamanya, tanpa kartu kredit, tidak pernah dihapus),
sementara aplikasinya berjalan di **Render** (hosting gratis, tanpa kartu
kredit).

## Langkah 1 — Buat Database Gratis di Turso (5 menit, tanpa kartu kredit)

1. Buka **turso.tech** lewat browser, klik **"Try Cloud free"** / daftar.
2. Setelah masuk ke dashboard, buat database baru (tombol "Create Database"),
   beri nama bebas misalnya `hokpos`.
3. Di halaman database tersebut, cari bagian **"Connect"** atau **"Create
   Token"**. Kamu akan melihat dua nilai:
   - **Database URL** (formatnya `libsql://nama-db-xxx.turso.io`)
   - **Auth Token** (teks panjang acak)
4. **Salin kedua nilai ini** — akan dipakai di Langkah 2.

Semua ini dilakukan dengan klik-klik di website mereka, tidak ada perintah
yang perlu diketik.

## Langkah 2 — Deploy Aplikasi ke Render (gratis, tanpa kartu kredit)

1. Buka **render.com**, daftar akun (bisa langsung pakai akun GitHub/Google).
2. Klik **"New +"** → **"Web Service"**.
3. Kalau diminta sumber kode: hubungkan akun GitHub kamu, lalu upload folder
   `hokpos-backend` ini ke repository baru di GitHub (lewat website GitHub:
   buat repo baru → "uploading an existing file" → seret semua file/folder
   ke sana). Kalau Render menawarkan opsi upload langsung tanpa GitHub,
   gunakan itu saja.
4. Isi pengaturan:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Di bagian **"Environment Variables"**, tambahkan tiga baris ini (klik "Add
   Environment Variable" untuk masing-masing — ini juga cuma isi kotak teks
   di website, bukan command line):
   - `TURSO_DATABASE_URL` → tempel Database URL dari Langkah 1
   - `TURSO_AUTH_TOKEN` → tempel Auth Token dari Langkah 1
   - `NODE_ENV` → `production`
6. Klik **"Create Web Service"**. Tunggu beberapa menit sampai statusnya
   "Live".
7. Kamu akan mendapat link permanen berformat `https://nama-app.onrender.com`
   — bisa dibuka siapa saja, kapan saja, gratis.

## Langkah 3 — Aktivasi Akun Admin (lewat formulir web, bukan command line)

Buka link dari Render tadi, tambahkan `/setup.html` di belakangnya:

```
https://nama-app-kamu.onrender.com/setup.html
```

Isi username, nama, dan password lewat formulir di layar, klik "Buat Akun
Admin". Halaman ini otomatis terkunci setelah dipakai sekali. Setelah itu,
buka link utamanya untuk login dan mulai memakai dashboard.

## Satu Hal yang Perlu Kamu Tahu (jujur, bukan menyembunyikan)

Render free tier akan "tidur" kalau tidak ada yang membuka aplikasinya
selama 15 menit — begitu ada yang membuka lagi, aplikasi otomatis menyala
dalam sekitar 30-60 detik (bukan error, cuma agak lambat di percobaan
pertama). Ini konsekuensi wajar dari memakai layanan gratis; data Anda tetap
aman karena tersimpan di Turso, bukan di Render.

## Alternatif: Deploy ke Netlify

Netlify juga gratis dan cocok, tapi cara kerjanya beda dari Render — Netlify
menjalankan aplikasi sebagai **fungsi serverless** (menyala sesaat per
permintaan), bukan server yang terus menyala. Backend ini sudah disiapkan
untuk itu (folder `netlify/functions/`, file `netlify.toml`) — tidak perlu
ubah apa-apa lagi.

**Langkahnya mirip Render**, dengan 2 perbedaan penting:

1. Saat menghubungkan repository GitHub kamu ke Netlify, Netlify akan otomatis
   mendeteksi `netlify.toml` dan mengatur semuanya — kamu tidak perlu mengisi
   Build/Start Command secara manual.
2. Di bagian **Environment Variables**, isi **tiga** nilai (bukan dua seperti
   di Render):
   - `TURSO_DATABASE_URL` dan `TURSO_AUTH_TOKEN` — sama seperti Langkah 1 di
     atas.
   - `JWT_SECRET` — **wajib diisi manual di Netlify** (berbeda dari Render).
     Buat string acak sendiri, panjang, bebas — misalnya ketik sembarang 40+
     karakter campuran huruf-angka. Ini penting karena tiap fungsi serverless
     di Netlify bisa berjalan di "kotak" yang berbeda-beda, jadi kalau
     dibiarkan kosong (auto-generate), sesi login bisa tiba-tiba dianggap
     tidak valid secara acak.

Setelah live, aktivasi admin lewat `/setup.html` seperti biasa, dan
kelebihannya, fungsi serverless Netlify biasanya menyala hampir instan
(jarang ada jeda "tidur" seperti di Render free tier).

## Fitur Baru: Link Pemesanan Online untuk Pelanggan

Setelah login sebagai admin, buka menu **Pengaturan** di dashboard — di sana
ada kotak berisi link pemesanan online (formatnya `link-anda.com/order.html`)
lengkap dengan tombol "Salin Link". Bagikan link itu ke pelanggan lewat
WhatsApp, Instagram bio, atau media lain.

**Yang otomatis tersinkron tanpa perlu tindakan tambahan:**
- Menu, harga, dan foto yang Anda ubah di halaman **Menu** langsung tampil
  di link pemesanan pelanggan — tidak ada delay atau proses publish terpisah.
- Stok yang habis otomatis menampilkan label "Habis" di halaman pelanggan.
- Setiap pesanan yang masuk dari link tersebut langsung muncul di halaman
  **Pesanan** dashboard Anda, lengkap dengan badge "🌐 Online" dan nama/nomor
  WhatsApp pelanggan, serta ada notifikasi di halaman Ringkasan.

**Alur pembayaran online (dirancang aman tanpa payment gateway pihak ketiga):**
1. Pelanggan memilih salah satu dari 3 metode: **Bayar di Tempat (COD)**,
   **Transfer Bank**, atau **QRIS** (info rekening/QRIS diatur di halaman
   Pengaturan admin).
2. Pesanan masuk ke dashboard berstatus **"Menunggu Konfirmasi"**.
3. Admin menekan **"Terima Pesanan"** setelah meninjau pesanan masuk.
4. Untuk Transfer/QRIS, admin memverifikasi bukti pembayaran secara manual
   (biasanya pelanggan diarahkan mengirim bukti transfer via WhatsApp toko),
   lalu menekan **"Tandai Lunas"**.
5. Admin menekan **"Tandai Selesai"** setelah pesanan diambil/diantar.

Pola ini umum dipakai bisnis F&B kecil-menengah dan tidak memerlukan akun
merchant payment gateway. Kalau ke depannya Anda ingin pembayaran online yang
benar-benar otomatis terverifikasi (kartu/e-wallet real-time), itu perlu
integrasi dengan payment gateway seperti Midtrans atau Xendit — yang
mengharuskan Anda mendaftar akun merchant sendiri (proses KYC di luar
kendali saya) — beri tahu saya kalau suatu saat ingin menambahkan ini.

## Yang Tersimpan Permanen (di Turso, tidak pernah hilang)
- `menu_items`, `inventory`, `orders` (termasuk yang dibatalkan — datanya
  diubah statusnya, bukan dihapus), `customers`, `promos`, `audit_log`, dan
  akun admin (hanya hash password, tidak pernah teks biasa)

## Keamanan
- Password admin di-hash dengan bcrypt — tidak pernah tersimpan atau
  terlihat sebagai teks biasa, bahkan oleh Anda sendiri.
- Sesi login memakai token JWT di cookie `httpOnly` — tidak bisa dibaca lewat
  F12/console browser.
- Percobaan login dibatasi otomatis untuk mencegah tebak-tebak password.
- Pesan error login sengaja umum ("username atau password salah").
- Halaman `/setup.html` otomatis terkunci setelah akun admin pertama dibuat.

## Kalau Ingin Coba Dulu di Komputer Sendiri (opsional)
```
npm install
npm start
```
Tanpa `TURSO_DATABASE_URL` diisi, sistem otomatis memakai file lokal
(`data/hokpos.db`) — cukup untuk mencoba-coba, tidak perlu akun Turso sama
sekali untuk ini. Buka `http://localhost:3000/setup.html` untuk membuat akun
admin lewat formulir.

## Kalau Ingin Ganti Password Admin Nanti
Jalankan `npm run create-admin` di komputer Anda (dengan `.env` berisi
`TURSO_DATABASE_URL` dan `TURSO_AUTH_TOKEN` yang sama seperti yang dipakai di
Render, supaya perubahan tersimpan ke database yang sama) — ini satu-satunya
bagian yang masih memakai command line, khusus untuk mengganti kredensial.

## Keterbatasan yang Perlu Diketahui
- Backend single-admin, satu server. Untuk banyak kasir/peran berbeda atau
  multi-cabang, strukturnya bisa diperluas kapan saja.
- Turso free tier: 5 GB penyimpanan, 500 juta baca/bulan — jauh lebih dari
  cukup untuk transaksi restoran sehari-hari, dan tidak pernah kedaluwarsa.
