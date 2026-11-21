# CLAUDE.md — Gedklin (SmartWash AI)

Panduan proyek untuk Claude Code. Baca file ini dulu sebelum mengerjakan apa pun di repo ini.

## Ringkasan proyek

Gedklin adalah platform manajemen operasional untuk **laundry kiloan** (mitra: Gedklin Laundry, Medan).
Proyek tugas besar mata kuliah Manajemen Proyek TI, periode **1 Oktober – 30 November 2026**.

Masalah yang diselesaikan:
1. Cucian yang sudah selesai sering tidak diambil tepat waktu, rak penyimpanan penuh.
2. Estimasi waktu selesai disamaratakan dan sering meleset saat ramai.
3. Pencatatan pesanan tersebar di nota, buku, dan chat, sehingga sulit dipantau.

Solusi inti:
- **Kasir/POS** untuk mencatat pesanan dan menghitung harga sesuai price list mitra.
- **Model ML** yang memprediksi kapan pesanan **siap diambil** berdasarkan isi pesanan + kondisi antrean.
- **Notifikasi WhatsApp** dengan jumlah pesan yang dibatasi.
- **Dasbor Pemilik** dan **Portal Tracking Pelanggan (PWA)**.

## Scope final (jangan dilebarkan tanpa persetujuan tim)

**Masuk scope**
- Seluruh layanan di price list mitra (lihat `apps/api/seed/price_catalog.json`): kiloan per load, setrika per kg, item khusus, dan item satuan.
- Satu model regresi: prediksi `duration_hours` = `ready_at - received_at` (dalam jam) per pesanan.
- Perbandingan algoritma: baseline median vs Linear Regression vs Random Forest vs XGBoost.
- Pilihan kecepatan: **Reguler** atau **Express** (Express tidak tercetak di price list, tapi ada menurut mitra).
- Urutan antrean berbasis aturan: **yang sudah diproses tidak disela, lalu Express bersama Reguler yang mendekati janji, lalu Reguler lain; FIFO di tiap kelompok** berdasarkan waktu masuk (detail di "Logika antrean dan ETA").
- Aturan notifikasi WhatsApp (lihat bagian "Aturan notifikasi").

**Di luar scope**, jangan diimplementasikan:
- Optimasi penjadwalan mesin/petugas (Google OR-Tools, CP-SAT, solver apa pun).
- Model terpisah per tahap (cuci, kering, setrika).
- Dataset publik sebagai data latih (LARCO, HFFS). Data latih hanya dari mitra.
- Pembayaran online, antar-jemput, integrasi IoT/sensor mesin.
- Aplikasi mobile native. Mobile cukup lewat PWA.

Kalau sebuah tugas terasa mengarah ke hal di atas, berhenti dan tanyakan dulu.

## Tech stack

| Bagian | Teknologi |
|---|---|
| Frontend | Next.js (App Router) + TypeScript (strict), PWA untuk portal tracking |
| Backend | FastAPI (Python 3.11+), SQLAlchemy 2.x, Alembic, Pydantic v2 |
| Database | PostgreSQL |
| Background job | Redis + Celery (worker + beat) |
| ML | pandas, scikit-learn, xgboost, joblib |
| Infra | Docker Compose untuk dev, CI/CD via GitHub Actions |
| Notifikasi | WhatsApp gateway (provider belum final, pakai adapter) |

## Struktur repo (target)

```
apps/
  web/            # Next.js: kasir, dasbor pemilik, portal tracking (PWA)
  api/            # FastAPI: REST API, harga, antrean, ETA, notifikasi
    app/
      models/     # SQLAlchemy models
      schemas/    # Pydantic schemas
      routers/
      services/   # pricing, queue, eta, notifications
      workers/    # Celery tasks
    seed/
      price_catalog.json   # price list mitra, sumber kebenaran harga
    alembic/
    tests/
ml/
  gedklin_ml/     # feature builder (features.py), DIPAKAI BERSAMA oleh training dan API
  data/           # raw/ dan processed/ (raw tidak di-commit)
  scripts/        # generate_dummy.py, build_dataset.py, train_compare.py
  models/         # artefak model terbaik (joblib) + metadata.json
  reports/        # tabel metrik hasil perbandingan
infra/
  docker-compose.yml
```

## Peran pengguna

| Role | Akses |
|---|---|
| `owner` (Pemilik) | Semua akses: dasbor, laporan + unduh CSV, kelola katalog dan harga, akun karyawan (tambah, ubah nama/peran, nonaktifkan), data operasional harian, log aktivitas, batalkan catatan pembayaran yang salah |
| `cashier` (Staff Kasir) | Buat pesanan, lihat harga dan ETA, kirim nota digital, update status termasuk menandai `READY`, catat pembayaran, koreksi/batalkan pesanan sebelum siap, kelola data pelanggan |
| `staff` (Staff) | Layar Antrean Cucian (`/antrean`): melihat urutan cucian aktif, menandai `PROCESSING` dan `READY` (+ lokasi rak). Tanpa harga, pembayaran, dan nomor HP pelanggan |
| Pelanggan | Tanpa login. Akses portal tracking lewat `tracking_code` |

Hierarki mengikuti tempat kerja: konter (Staff Kasir), area cuci/setrika (Staff), dan manajemen (Pemilik). Akun pemilik dibuat lewat seed; dari aplikasi pemilik hanya menambah atau mengubah akun Staff Kasir dan Staff. Kasir tetap bisa mengubah semua status bila Staff tidak memegang perangkat. Role ini dulu bernama `admin` (hanya tindak lanjut); migrasi `0011` mengganti namanya menjadi `staff` dan tindak lanjut pindah ke kasir.

## Katalog layanan dan harga

Price list awal: `apps/api/seed/price_catalog.json`. Di-seed ke tabel `service_catalog` saat katalog masih kosong. Setelah itu pemilik mengelola layanan dari dasbor (tambah, ubah, nonaktifkan, hapus bila belum pernah dipesan). **Jangan hardcode harga di kode.**

Kelompok layanan:

| Kelompok | Contoh | Satuan harga |
|---|---|---|
| Kiloan | Cuci (C), Cuci+Kering (CK), Cuci+Kering+Lipat (CKL), Cuci+Kering+Setrika (CKS) | Harga 7 kg pertama + tambahan per kg untuk sisa beratnya |
| Setrika saja | Setrika per kg | Per kg, minimal 5 kg |
| Khusus | Bed cover, gordyn, jaket, selimut, sprei | Per pcs, per kg, atau per load, dengan aturan min/maks |
| Satuan | Boneka, celana, gamis, gaun, kaos, kemeja, khimar | Per pcs, dicuci dan disetrika **manual tanpa mesin** |
| Dry clean | Songket, kain tenun, kebaya payet | Per pcs, harga belum diketahui |

Setiap item katalog punya `process`: C, CK, CKL, CKS, S (setrika saja), SATUAN (cuci-setrika manual), DRY_CLEAN. Process dipakai untuk fitur ML.

**Express:** tidak ada di price list, tetapi tersedia menurut mitra, dan **hanya untuk item CKL dan CKS**.
- Harga Express = harga Reguler × 2, berlaku untuk harga 7 kg pertama **dan** tambahan per kg.
- Contoh CKS 8 kg: Reguler = 45.000 + 10.000 = 55.000. Express = 90.000 + 20.000 = 110.000.
- Simpan sebagai pengaturan `express_multiplier` (default 2) dan flag `express_eligible` per item katalog. Jangan hardcode.
- Di UI kasir, pilihan Express hanya aktif jika pesanan berisi item CKL atau CKS. Validasi yang sama juga wajib di backend.
- Jika pesanan Express berisi item lain (misalnya bed cover), hanya item CKL/CKS yang dikali 2. Item lain tetap harga Reguler.

**Janji waktu standar mitra** (dipakai sebagai `promised_ready_at` dan sebagai baseline ML):

| Layanan | Janji |
|---|---|
| Reguler CKL | 2 hari |
| Reguler CKS | 3–4 hari (pakai 4 hari sebagai janji, 3 hari sebagai batas bawah) |
| Express CKL dan CKS | 1 hari |
| Reguler C, CK, setrika saja, item khusus, satuan, dry clean | Belum diketahui, simpan di tabel pengaturan `service_promise` agar mudah diisi |

Satu "hari" dihitung sebagai hari kalender. Jika janji jatuh setelah jam tutup, geser ke jam buka hari berikutnya.

**Aturan harga kiloan (sudah dikonfirmasi mitra):**
- `extra_kg = max(0, ceil(weight_kg - 7))` (pembulatan ke atas per kg masih asumsi)
- `subtotal = price + extra_kg * extra_price_per_kg`
- Berat di atas 8 kg **tidak** dihitung load kedua. Semua kelebihan di atas 7 kg kena tarif tambahan per kg.
- Tarif tambahan per kg: C 3.000, CK 5.000, CKL 7.000, CKS 10.000.
- Contoh CKS Reguler: 5 kg = 45.000. 8 kg = 55.000. 12 kg = 45.000 + 5 × 10.000 = 95.000.

**Load operasional (untuk fitur ML, terpisah dari harga):**
- Satu mesin menampung maksimal 8 kg, jadi `machine_loads = ceil(weight_kg / 8)`.
- Contoh: 8 kg = 1 load mesin, 12 kg = 2 load mesin, walaupun harganya dihitung per kg.

Semua logika harga ada di satu modul `services/pricing.py` dengan unit test untuk setiap aturan min/maks di katalog.

## Kapasitas mitra

| Sumber daya | Jumlah |
|---|---|
| Mesin cuci | 4 |
| Mesin pengering | 3 |
| Petugas | 2 orang |
| Jam operasional | 08.00 – 17.00 WIB (9 jam per hari) |

- Simpan sebagai default di pengaturan, dan catat kondisi harian di `daily_operations` karena mesin bisa rusak dan petugas bisa izin.
- Pengering lebih sedikit daripada mesin cuci, jadi pengering berpotensi menjadi titik antrean untuk layanan CK, CKL, dan CKS.
- Hanya 2 petugas yang mengerjakan cuci, kering, lipat, dan setrika, jadi setrika (CKS dan setrika saja) kemungkinan besar penyebab utama durasi yang panjang.
- Pesanan yang masuk mendekati 17.00 baru diproses besok pagi. Durasi pesanan yang melewati malam akan terlihat melonjak, dan ini harus tertangkap oleh fitur `minutes_to_close`.

## Alur status pesanan

```
RECEIVED → PROCESSING → READY → PICKED_UP
    └──────────┴──→ CANCELLED (dengan alasan)
```

- Status sengaja disederhanakan karena hanya kasir yang memperbarui status.
- `CANCELLED` hanya dari `RECEIVED`/`PROCESSING` dan hanya bila belum lunas. Pesanan batal keluar dari antrean, tidak dihitung pendapatan, dan tidak masuk fitur antrean ML setelah `cancelled_at`.
- Isi pesanan bisa dikoreksi (salah input berat/layanan) dengan syarat yang sama; harga dan janji dihitung ulang.
- Pembayaran dicatat di konter (tunai/QRIS/transfer), bukan pembayaran online. Bisa lunas saat pesanan dibuat atau saat diambil; `PICKED_UP` wajib lunas.
- Lokasi rak (opsional) diisi saat `READY` supaya cucian cepat ditemukan.
- `ready_at` diisi saat status berubah ke `READY` (selesai dikemas). Ini **target ML**, bukan `picked_up_at`.
- Setiap perubahan status dicatat di `order_status_history`.

## Model data (inti)

- `users` (id, name, role, ...)
- `customers` (id, name, phone_wa) — nomor HP **tidak pernah** masuk dataset ML atau tampil di portal tracking.
- `service_catalog` (code, name, group, process, unit, price, extra_price, min/max rules, is_active)
- `orders`
  - id, tracking_code (acak, tidak mudah ditebak), customer_id
  - received_at, ready_at, picked_up_at, status, price_total, is_express
  - promised_ready_at (dari janji standar), predicted_ready_at (dari model), last_notified_eta, delay_notif_count (0–2)
  - ready_notif_sent (bool), needs_followup (bool)
  - notes (catatan kondisi/permintaan), rack_location
  - payment_method (CASH/QRIS/TRANSFER), paid_at (NULL = belum lunas)
  - cancelled_at, cancel_reason
- `order_items` (order_id, catalog_code, process, weight_kg, qty_pcs, machine_loads, extra_kg, is_express, subtotal)
  - Satu pesanan bisa berisi beberapa item, misalnya 6 kg CKS + 1 bed cover + 2 kemeja.
- `order_status_history` (order_id, from_status, to_status, changed_at, changed_by)
- `daily_operations` (date, is_open, staff_on_duty (default 2), washers_available (default 4), dryers_available (default 3), open_time (default 08:00), close_time (default 17:00), machine_issue_note)
- `notifications` (order_id, type: RECEIPT/READY/DELAY, sent_at, status, provider_msg_id)
  - Unique constraint untuk (order_id, type='READY') dan (order_id, type='RECEIPT') supaya nota dan notifikasi siap diambil tidak dobel.
- `prediction_logs` (order_id, features_json, predicted_hours, model_version, created_at)
- `activity_logs` (user_id, action, entity_type, entity_id, summary, changes, created_at): siapa melakukan apa dan kapan, termasuk sebelum → sesudah untuk perubahan layanan, harga, akun, pengaturan, dan operasional. Password tidak pernah dicatat. Hanya pemilik yang bisa melihat (`/dasbor/log`).

Simpan waktu dalam UTC di database, tampilkan dalam **Asia/Jakarta**.

## Logika antrean dan ETA

1. Urutan antrean untuk pesanan yang belum `READY` (`app/services/queue.py`):
   1. `PROCESSING` sebelum `RECEIVED`: cucian yang sudah di mesin/setrika tidak disela.
   2. Kelompok prioritas: Express **dan** Reguler yang janjinya tinggal ≤ `REGULAR_ESCALATION_HOURS` (default 8 jam, menunggu kesepakatan mitra) atau sudah lewat. Keduanya diurutkan FIFO bersama, jadi Express yang datang belakangan tidak menyalip Reguler yang mepet.
   3. Reguler lainnya.
   4. Di dalam tiap kelompok: FIFO berdasarkan `received_at`.
2. Fitur dihitung **saat pesanan masuk** (tidak boleh memakai info masa depan):

   | Kelompok | Fitur |
   |---|---|
   | Isi pesanan | `is_express`, `total_machine_loads`, `total_weight_kg`, `max_process_level` (C=1, CK=2, CKL=3, CKS=4), `has_ironing`, `ironing_kg`, `n_special_items`, `n_satuan_items`, `n_dry_clean_items` |
   | Waktu | `hour_of_day`, `day_of_week`, `minutes_to_close` |
   | Antrean | `active_orders_count`, `active_express_count`, `active_loads_total`, `active_ironing_kg`, `active_satuan_items` (pesanan yang sudah masuk tapi belum `READY` pada saat itu) |
   | Janji | `promised_hours` (janji standar dalam jam, dari tabel `service_promise`) |
   | Operasional | `staff_on_duty`, `washers_available`, `dryers_available` dari `daily_operations` |
   | Rasio beban | `loads_per_washer` = `active_loads_total / washers_available`, `dry_loads_per_dryer` = load aktif yang butuh pengering / `dryers_available` |

   `has_ironing` bernilai true jika ada item dengan process CKS, S, atau SATUAN. Setrika dan item satuan dikerjakan manual oleh 2 petugas yang sama, tanpa mesin, sehingga kemungkinan besar jadi penyebab antrean. Item satuan dan dry clean tidak menambah `machine_loads`.
3. ETA dihitung ulang saat ada pesanan baru, perubahan status, koreksi, atau pembatalan, untuk pesanan yang belum `READY`. ETA hanya berubah bila masukannya berubah (antrean di depannya, isi pesanan, operasional harian). ETA yang sudah lewat **tidak digeser**.
   - Model memprediksi **jam operasional**; ETA = `add_work_hours(received_at, prediksi)`, sehingga selalu jatuh di jam buka dan tersebar sepanjang hari.
   - `promised_ready_at` (janji standar) adalah kontrak dengan pelanggan dan **tolok ukur terlambat**: pesanan aktif terlambat bila sekarang > `promised_ready_at`. UI menampilkan "Terlambat · lewat X jam" dari janji, bukan dari perkiraan.
   - Perkiraan sudah lewat tapi janji belum: UI menampilkan "Segera siap" tanpa jam karangan.
   - `initial_predicted_ready_at` menyimpan perkiraan di nota; akurasi di dasbor diukur dari kolom ini.
4. Service `eta` memuat model dari `MODEL_PATH`. Jika model tidak ada atau gagal, **fallback ke `promised_ready_at`**. Aplikasi tidak boleh crash karena model.

## Aturan notifikasi WhatsApp

| Kejadian | Aturan |
|---|---|
| Pesanan dibuat | Kirim **1 kali** nota digital (isi, total, status bayar, perkiraan siap, link lacak) lewat gateway. Idempoten. Tombol WA di kasir tetap ada untuk kirim ulang manual. |
| Pesanan berubah ke `READY` | Kirim **1 kali** notifikasi siap diambil. Idempoten. |
| ETA mundur karena overload | Hanya pesanan **Reguler**. Kirim jika ETA baru > `last_notified_eta` + `DELAY_THRESHOLD_HOURS` (default 6 jam, menunggu kesepakatan mitra). **Maksimal 2 kali** per pesanan. |
| Belum diambil > 3 hari setelah `ready_at` | **Tidak** kirim WA otomatis. Celery beat harian set `needs_followup = true`, muncul di halaman Tindak Lanjut (`/tindak-lanjut`), kasir menghubungi manual. |

- Pengiriman lewat Celery task dengan retry. Kegagalan dicatat di `notifications`.
- Implementasikan `NotificationSender` sebagai interface + adapter per provider. Mode dev: `ConsoleSender` yang hanya log.

## Pipeline ML

**Data**
- Sumber: pencatatan pesanan di mitra (±14 Okt – 7 Nov 2026).
- Form pencatatan mentah (satu baris per pesanan): `order_id, received_at, ready_at, layanan_utama, express, berat_kg, pcs_khusus, pcs_satuan, pcs_dry_clean, ada_setrika`, plus tabel harian `date, staff_on_duty, washers_available, dryers_available, open_time, close_time`.
- `build_dataset.py` mengubah data mentah menjadi fitur di atas. Fitur antrean dihitung dari data itu sendiri, tidak dicatat manual.
- Buang 2–3 hari pertama jika stok cucian awal tidak tercatat.

**Data dummy**
- `generate_dummy.py` menghasilkan data dengan **kolom yang sama persis** dengan form pencatatan.
- Pola dibuat masuk akal: jam ramai, durasi mengikuti janji mitra (Express sekitar 1 hari, CKL sekitar 2 hari, CKS 3–4 hari), setrika dan antrean panjang memperlama, lewat jam tutup lanjut besok.
- Gunakan kapasitas 4 mesin cuci dan 3 pengering saat mensimulasikan antrean, dan sesekali buat hari dengan mesin yang rusak.
- Dummy hanya untuk menguji pipeline dan aplikasi. **Metrik dari data dummy tidak boleh dilaporkan sebagai hasil.**

**Eksperimen** (`train_compare.py`)
- Split **berdasarkan waktu** (minggu-minggu awal = train, minggu terakhir = test). **Jangan** split acak.
- Model yang dibandingkan:
  - **Baseline 1, janji mitra**: prediksi = `promised_hours`. Ini kondisi saat ini, yang ingin dikalahkan.
  - **Baseline 2, median**: median durasi per (`max_process_level`, `is_express`) dari data train.
  - LinearRegression, RandomForestRegressor, XGBRegressor.
- Semua durasi dan error dalam satuan **jam**, karena durasi pesanan 1–4 hari.
- Model belajar `duration_work_hours` (durasi dalam jam operasional hari buka), karena cucian tidak dikerjakan saat toko tutup. Error tetap diukur dalam **jam kalender** (`duration_hours`, yang dilihat pelanggan): prediksi diubah ke waktu siap dengan `add_work_hours` persis seperti API, dan baseline janji mitra dengan `shift_into_open_hours`. Evaluasi harus meniru cara API menghitung ETA.
- Metrik: MAE (utama), RMSE, R², dan persentase prediksi dengan error < `ETA_TOLERANCE_HOURS` (default 6 jam).
- Laporkan juga MAE per `max_process_level` dan per Reguler/Express.
- Target: MAE lebih kecil dari kedua baseline. Target angka absolut ditetapkan setelah melihat sebaran data pada minggu kedua pengumpulan.
- Output: `ml/reports/comparison.csv`, model terbaik ke `ml/models/best_model.joblib` + `metadata.json` (nama model, versi, daftar dan urutan fitur, tanggal latih, metrik).
- Feature builder di `ml/gedklin_ml/features.py` dipakai bersama oleh training dan API. Jangan duplikasi logika fitur.

## Konvensi kode

- Python: type hints, ruff untuk lint dan format, pytest untuk test.
- TypeScript: strict mode, ESLint + Prettier.
- Perubahan skema database selalu lewat migrasi Alembic.
- Endpoint publik (portal tracking) hanya menerima `tracking_code` dan tidak mengembalikan data pribadi: nama pelanggan hanya samaran (mis. "Ni** R."), tanpa nomor HP, nama petugas, atau catatan. Total dan status bayar boleh tampil.
- Konfigurasi lewat environment variable (`DATABASE_URL`, `REDIS_URL`, `MODEL_PATH`, `DELAY_THRESHOLD_HOURS`, `ETA_TOLERANCE_HOURS`, `WA_PROVIDER`, `WA_API_KEY`). Jangan hardcode secret.
- Harga selalu dalam Rupiah bertipe integer.
- Teks UI dalam Bahasa Indonesia.

## Perintah

```bash
docker compose -f infra/docker-compose.yml up -d
cd apps/api && alembic upgrade head && python -m app.seed && uvicorn app.main:app --reload
cd apps/api && celery -A app.workers worker -B --loglevel=info
cd apps/web && npm run dev
cd ml && python scripts/generate_dummy.py && python scripts/build_dataset.py && python scripts/train_compare.py
cd apps/api && pytest
```

## Milestone

| Kode | Milestone | Tanggal |
|---|---|---|
| M1 | Project Charter disetujui | 3 Okt 2026 |
| M2 | Perencanaan dan desain selesai | 14 Okt 2026 |
| M3 | Sprint 1 selesai | 28 Okt 2026 |
| M4 | Data pesanan mitra terkumpul | 7 Nov 2026 |
| M5 | Model terbaik terpilih | 11 Nov 2026 |
| M6 | Integrasi model dan notifikasi selesai | 18 Nov 2026 |
| M7 | UAT selesai | 25 Nov 2026 |
| M8 | Go-live dan penutupan proyek | 30 Nov 2026 |

## Hal yang masih terbuka (konfirmasi ke mitra)

- Harga dry clean untuk songket, kain tenun, dan kebaya payet, serta apakah dikerjakan sendiri atau dititipkan ke pihak lain.
- Janji waktu Reguler untuk Cuci, Cuci+Kering, setrika saja, item khusus, item satuan, dan dry clean.
- Kelebihan berat dibulatkan ke atas per kg atau dihitung per ons (misalnya 7,3 kg).
- Provider WhatsApp gateway.
- Nilai final `DELAY_THRESHOLD_HOURS`.
- Hari libur: apakah buka setiap hari termasuk Minggu dan tanggal merah.