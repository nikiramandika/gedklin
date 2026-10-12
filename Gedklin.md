# CLAUDE.md — Gedklin (SmartWash AI)

Panduan proyek untuk Claude Code. Baca file ini dulu sebelum mengerjakan apa pun di repo ini.

## Ringkasan proyek

Gedklin adalah platform manajemen operasional untuk **laundry kiloan** (mitra: Gedklin Laundry, Medan).
Proyek tugas besar mata kuliah Manajemen Proyek TI, periode **1 Oktober – 30 November 2026**.

Masalah yang diselesaikan:
1. Cucian yang sudah selesai sering tidak diambil tepat waktu, rak penyimpanan penuh.
2. Estimasi waktu selesai disamaratakan ("2 hari jadi") dan sering meleset saat ramai.
3. Pencatatan pesanan tersebar di nota, buku, dan chat, sehingga sulit dipantau.

Solusi inti:
- **Kasir/POS** untuk mencatat pesanan secara terpusat.
- **Model ML** yang memprediksi kapan pesanan **siap diambil** berdasarkan karakteristik pesanan + kondisi antrean.
- **Notifikasi WhatsApp** dengan jumlah pesan yang dibatasi.
- **Dasbor Pemilik** dan **Portal Tracking Pelanggan (PWA)**.

## Scope final (jangan dilebarkan tanpa persetujuan tim)

**Masuk scope**
- Layanan: Cuci-Kering (CK) dan Cuci-Kering-Setrika (CKS), masing-masing Reguler atau Express.
- Satu model regresi: prediksi `duration_minutes` = `ready_at - received_at` per pesanan.
- Perbandingan algoritma: baseline median vs Linear Regression vs Random Forest vs XGBoost.
- Urutan antrean berbasis aturan: **Express dulu, lalu FIFO** berdasarkan waktu masuk.
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
  api/            # FastAPI: REST API, logika antrean, ETA, notifikasi
    app/
      models/     # SQLAlchemy models
      schemas/    # Pydantic schemas
      routers/
      services/   # queue, eta, notifications
      workers/    # Celery tasks
    alembic/
    tests/
ml/
  data/           # raw/ dan processed/ (raw tidak di-commit)
  scripts/        # generate_dummy.py, build_features.py, train_compare.py
  models/         # artefak model terbaik (joblib) + metadata.json
  reports/        # tabel metrik hasil perbandingan
infra/
  docker-compose.yml
```

## Peran pengguna

| Role | Akses |
|---|---|
| `owner` | Dasbor, kelola layanan/harga, akun kasir dan admin, data operasional harian |
| `admin` | Daftar pesanan yang perlu ditindaklanjuti (belum diambil > 3 hari) |
| `cashier` | Buat pesanan, lihat ETA, cetak/kirim nota digital, update status pesanan termasuk menandai `READY` |
| Pelanggan | Tanpa login. Akses portal tracking lewat `tracking_code` |

Tidak ada role `staff`. Petugas cuci/setrika tidak memakai sistem, semua perubahan status dilakukan oleh kasir.

## Alur status pesanan

```
RECEIVED → WASHING → DRYING → [IRONING, khusus CKS] → READY → PICKED_UP
```

- `ready_at` diisi saat status berubah ke `READY` (selesai dikemas). Ini **target ML**, bukan `picked_up_at`.
- Setiap perubahan status dicatat di `order_status_history`.

## Model data (inti)

- `users` (id, name, role, ...)
- `customers` (id, name, phone_wa) — nomor HP **tidak pernah** masuk dataset ML atau tampil di portal tracking.
- `services` (code: CK/CKS, price_per_kg_regular, price_per_kg_express)
- `orders`
  - id, tracking_code (acak, tidak mudah ditebak), customer_id
  - service_type (CK/CKS), is_express, weight_kg, price_total
  - received_at, ready_at, picked_up_at, status
  - predicted_ready_at, last_notified_eta, delay_notif_count (0–2)
  - ready_notif_sent (bool), needs_followup (bool)
- `order_status_history` (order_id, from_status, to_status, changed_at, changed_by)
- `daily_operations` (date, staff_on_duty, open_time, close_time, machine_issue_note)
- `notifications` (order_id, type: READY/DELAY, sent_at, status, provider_msg_id)
  - Unique constraint untuk (order_id, type='READY') supaya notifikasi siap diambil tidak dobel.
- `prediction_logs` (order_id, features_json, predicted_minutes, model_version, created_at)

Simpan waktu dalam UTC di database, tampilkan dalam **Asia/Jakarta**.

## Logika antrean dan ETA

1. Urutan antrean: `ORDER BY is_express DESC, received_at ASC` untuk pesanan dengan status sebelum `READY`.
2. Fitur yang dihitung **saat pesanan masuk** (tidak boleh memakai info masa depan):
   - `weight_kg`, `service_type`, `is_express`
   - `hour_of_day`, `day_of_week`
   - `active_orders_count`: pesanan yang sudah masuk tapi belum `READY` pada saat itu
   - `active_kg_total`: total berat pesanan aktif tersebut
   - `staff_on_duty` dari `daily_operations`
   - `minutes_to_close`: sisa menit sampai jam tutup hari itu
3. ETA dihitung ulang saat ada pesanan baru atau perubahan status, untuk pesanan yang belum `READY`.
4. Service `eta` memuat model dari `MODEL_PATH`. Jika model tidak ada atau gagal, **fallback ke baseline median** per (service_type, is_express). Aplikasi tidak boleh crash karena model.

## Aturan notifikasi WhatsApp

| Kejadian | Aturan |
|---|---|
| Pesanan berubah ke `READY` | Kirim **1 kali** notifikasi siap diambil. Idempoten. |
| ETA mundur karena overload | Hanya pesanan **Reguler**. Kirim jika ETA baru > `last_notified_eta` + `DELAY_THRESHOLD_MINUTES` (default 30, menunggu kesepakatan mitra). **Maksimal 2 kali** per pesanan. |
| Belum diambil > 3 hari setelah `ready_at` | **Tidak** kirim WA otomatis. Celery beat harian set `needs_followup = true`, muncul di halaman admin, admin menghubungi manual. |

- Pengiriman lewat Celery task dengan retry. Kegagalan dicatat di `notifications`.
- Implementasikan `NotificationSender` sebagai interface + adapter per provider. Mode dev: `ConsoleSender` yang hanya log.

## Pipeline ML

**Data**
- Sumber: pencatatan pesanan di mitra (±14 Okt – 7 Nov 2026), satu baris per pesanan.
- Kolom mentah sama persis dengan form pencatatan: `order_id, received_at, weight_kg, service_type, is_express, ready_at`, plus tabel harian `date, staff_on_duty, open_time, close_time`.
- Fitur antrean dihitung dari data itu sendiri di `build_features.py`, tidak dicatat manual.
- Buang 2–3 hari pertama jika stok cucian awal tidak tercatat.

**Data dummy**
- `generate_dummy.py` menghasilkan data dengan **kolom yang sama persis** dengan data asli.
- Pola dibuat masuk akal: jam ramai, durasi dasar beda per layanan, antrean panjang memperlama, lewat jam tutup lanjut besok.
- Dummy hanya untuk menguji pipeline dan aplikasi. **Metrik dari data dummy tidak boleh dilaporkan sebagai hasil.**

**Eksperimen** (`train_compare.py`)
- Split **berdasarkan waktu** (minggu-minggu awal = train, minggu terakhir = test). **Jangan** split acak.
- Model: baseline median, LinearRegression, RandomForestRegressor, XGBRegressor.
- Metrik: MAE (utama), RMSE, R², dan persentase prediksi dengan error < 30 menit.
- Target: MAE lebih kecil dari baseline, target awal < 30 menit.
- Output: `ml/reports/comparison.csv`, model terbaik ke `ml/models/best_model.joblib` + `metadata.json` (nama model, versi, daftar fitur, urutan fitur, tanggal latih, metrik).
- Fitur yang dipakai saat inferensi di API harus dibangun dengan fungsi yang sama dengan saat training (bagikan modul feature builder, jangan duplikasi logika).

## Konvensi kode

- Python: type hints, ruff untuk lint dan format, pytest untuk test.
- TypeScript: strict mode, ESLint + Prettier.
- Perubahan skema database selalu lewat migrasi Alembic.
- Endpoint publik (portal tracking) hanya menerima `tracking_code` dan tidak mengembalikan data pribadi.
- Konfigurasi lewat environment variable (`DATABASE_URL`, `REDIS_URL`, `MODEL_PATH`, `DELAY_THRESHOLD_MINUTES`, `WA_PROVIDER`, `WA_API_KEY`). Jangan hardcode secret.
- Teks UI dalam Bahasa Indonesia.

## Perintah (isi setelah scaffold dibuat)

```bash
# docker compose -f infra/docker-compose.yml up -d
# cd apps/api && alembic upgrade head && uvicorn app.main:app --reload
# cd apps/api && celery -A app.workers worker -B --loglevel=info
# cd apps/web && npm run dev
# cd ml && python scripts/generate_dummy.py && python scripts/train_compare.py
# cd apps/api && pytest
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

## Hal yang masih terbuka

- Provider WhatsApp gateway belum dipilih.
- Nilai `DELAY_THRESHOLD_MINUTES` final menunggu kesepakatan dengan mitra.
- Jam operasional, jumlah mesin, dan jumlah petugas mitra diisi dari hasil wawancara.
