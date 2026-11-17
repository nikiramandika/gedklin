# Gedklin (SmartWash AI)

Platform manajemen operasional laundry kiloan untuk mitra **Gedklin Laundry, Medan**:
kasir/POS, prediksi waktu siap diambil berbasis ML, notifikasi WhatsApp terbatas,
dasbor pemilik, dan portal tracking pelanggan (PWA).


## Struktur

```
apps/api   FastAPI + SQLAlchemy + Alembic + Celery (harga, antrean, ETA, notifikasi)
apps/web   Next.js 16 (App Router, TypeScript strict): kasir, dasbor, admin, portal /lacak (PWA)
ml/        Paket gedklin_ml (feature builder bersama API & training) + script pipeline
infra/     docker-compose (Postgres + Redis; profil `app` untuk semua service)
```

## Menjalankan secara lokal

Prasyarat: Python 3.11, Node 22+, Docker (atau Postgres 16 + Redis lokal).

```bash
# 1. Database & Redis
docker compose -f infra/docker-compose.yml up -d

# 2. Python env (dipakai API dan ML)
python3.11 -m venv .venv && source .venv/bin/activate
# requirements memuat `-e ../../ml` (relatif ke folder kerja), jadi install dari apps/api
(cd apps/api && pip install -r requirements-dev.txt)

# 3. Model (pakai data dummy sampai data mitra terkumpul)
cd ml && python scripts/generate_dummy.py && python scripts/build_dataset.py && python scripts/train_compare.py && cd ..

# 4. API
cd apps/api
cp .env.example .env            # isi SEED_OWNER_PASSWORD dan JWT_SECRET (lihat di bawah)
alembic upgrade head
python -m app.seed              # katalog harga, janji waktu, pengaturan + akun owner
uvicorn app.main:app --reload   # http://localhost:8000/docs

# 5. Worker + beat (terminal lain). Tanpa Redis: set CELERY_TASK_ALWAYS_EAGER=true di .env
celery -A app.workers worker -B --loglevel=info

# 6. Web (terminal lain)
cd apps/web && cp .env.example .env.local && npm install && npm run dev   # http://localhost:3000
```

### Windows (PowerShell)

Jalankan dari root repo. Docker Desktop harus sudah menyala.

```powershell
# 1. Database & Redis
docker compose -f infra/docker-compose.yml up -d

# 2. Python env (dipakai API dan ML)
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
# Jika muncul error "running scripts is disabled", jalankan sekali:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# requirements memuat `-e ../../ml` (relatif ke folder kerja), jadi install dari apps/api
cd apps/api; pip install -r requirements-dev.txt; cd ../..

# 3. Model (pakai data dummy sampai data mitra terkumpul)
cd ml
python scripts/generate_dummy.py
python scripts/build_dataset.py
python scripts/train_compare.py
cd ..

# 4. API
cd apps/api
Copy-Item .env.example .env     # isi SEED_OWNER_PASSWORD dan JWT_SECRET (lihat di bawah)
alembic upgrade head
python -m app.seed              # katalog harga, janji waktu, pengaturan + akun owner
uvicorn app.main:app --reload   # http://localhost:8000/docs

# 5a. Worker (terminal lain, aktifkan .venv dulu, dari apps/api)
#     Windows tidak mendukung pool prefork maupun opsi -B, jadi pakai --pool=solo
#     dan jalankan beat terpisah. Tanpa Redis: set CELERY_TASK_ALWAYS_EAGER=true di .env
celery -A app.workers worker --pool=solo --loglevel=info

# 5b. Beat / jadwal berkala (terminal lain, aktifkan .venv dulu, dari apps/api)
celery -A app.workers beat --loglevel=info

# 6. Web (terminal lain, dari root repo)
cd apps/web
Copy-Item .env.example .env.local
npm install
npm run dev                     # http://localhost:3000
```

Di terminal baru, aktifkan venv dengan `.\.venv\Scripts\Activate.ps1` (dari root repo) sebelum
menjalankan `uvicorn` atau `celery`. Kalau pakai Command Prompt (cmd), aktivasinya
`.venv\Scripts\activate.bat` dan ganti `Copy-Item` dengan `copy`.

Halaman: `/login`, `/kasir`, `/dasbor` (+ `/operasional`, `/layanan`, `/akun`), `/admin`,
`/lacak` dan `/lacak/<kode>` (publik).

### Isi `apps/api/.env` untuk lokal

Setiap anggota tim punya `.env` sendiri (tidak di-commit) dan database lokal sendiri.

| Variabel | Isi untuk lokal |
|---|---|
| `JWT_SECRET` | String acak untuk menandatangani token login. Buat dengan `python -c "import secrets; print(secrets.token_hex(32))"`. Kalau diganti, semua sesi login lama keluar. |
| `SEED_OWNER_USERNAME` / `SEED_OWNER_PASSWORD` | Akun owner pertama yang dibuat `python -m app.seed`. Bebas, misalnya `owner` / `owner123`. |
| `WA_PROVIDER` | Biarkan `console`: pesan WA hanya ditulis ke log worker, tidak terkirim. Jangan pakai token Fonnte production di lokal. |
| `CELERY_TASK_ALWAYS_EAGER` | `true` kalau tidak mau menjalankan worker/Redis; notifikasi diproses langsung. |
| Lainnya | Nilai bawaan sudah cocok dengan `infra/docker-compose.yml`. |

Production memakai `.env` terpisah di server (`/opt/gedklin/.env`), jadi nilai lokal tidak memengaruhi gedklin.my.id.

## Test & lint

```bash
cd apps/api && pytest                     # SQLite; set TEST_DATABASE_URL untuk Postgres
ruff check apps/api ml && ruff format --check apps/api ml
cd apps/web && npm run lint && npx tsc --noEmit && npm run build
```

## Harga & janji waktu

- Price list awal mitra ada di `apps/api/seed/price_catalog.json`. `python -m app.seed` mengisinya ke
  `service_catalog` **hanya bila katalog masih kosong**, plus `service_promise` dan `app_settings`
  yang belum ada. Setelah itu pemilik mengelola layanan di `/dasbor/layanan`: tambah, ubah (nama,
  kelompok, proses, satuan, harga, aturan min/maks, Bisa Express), nonaktifkan, dan hapus. Layanan
  yang sudah dipakai di pesanan tidak bisa dihapus, cukup dinonaktifkan. Pengali Express, kapasitas
  mesin, dan janji waktu juga diatur di halaman itu. Item dry clean belum punya harga, jadi
  nonaktif sampai harganya diisi.
- Semua aturan harga (kiloan: harga 7 kg pertama + tambahan per kg untuk sisa berat, minimal kg,
  per pcs, per load item khusus, Express = Reguler × `express_multiplier` hanya untuk item
  `express_eligible` yaitu CKL dan CKS) ada di `apps/api/app/services/pricing.py`.
  Form kasir memanggil `POST /orders/quote`, jadi aturan harga tidak diduplikasi di frontend.
- Load mesin (`machine_loads = ceil(kg / machine_capacity_kg)`, default 8 kg) hanya untuk fitur ML,
  terpisah dari harga.
- Status pesanan: `RECEIVED → PROCESSING → READY → PICKED_UP`, plus `CANCELLED` (dengan alasan,
  sebelum siap dan belum lunas). Tandai Diambil wajib lunas; pembayaran dicatat tunai/QRIS/transfer.
- Pemilik: `/dasbor/laporan` (per periode, per layanan/kasir/metode bayar, unduh CSV) dan
  `/dasbor/log`. Kasir dan pemilik: `/pelanggan` (riwayat, tagihan belum lunas, ubah data).
- Login dikunci 15 menit setelah 5 kali salah per username; petugas bisa ganti password sendiri.

## Data & model

- Form pencatatan mitra: `ml/data/raw/orders.csv` (`order_id, received_at, ready_at, layanan_utama,
  express, berat_kg, pcs_khusus, pcs_satuan, pcs_dry_clean, ada_setrika`) dan `ml/data/raw/daily.csv` (`date,
  staff_on_duty, washers_available, dryers_available, open_time, close_time`). Tidak di-commit.
  Jika ada, script otomatis memakainya; jika tidak, memakai `*_dummy.csv`.
- `build_dataset.py` mengubah data mentah menjadi fitur (`ml/data/processed/features.csv`) memakai
  feature builder bersama `ml/gedklin_ml/features.py` yang juga dipakai API.
- `train_compare.py` membandingkan baseline janji mitra, baseline median, Linear Regression,
  Random Forest, dan XGBoost dengan split berbasis waktu. Model belajar `duration_work_hours`
  (jam operasional); prediksinya diubah ke waktu kalender dengan `add_work_hours`, persis seperti
  API, lalu error diukur dalam jam kalender dengan toleransi `ETA_TOLERANCE_HOURS` (default 6).
  `ml/data/raw/daily.csv` dibutuhkan untuk konversi ini. Hasil: `ml/reports/comparison.csv`,
  `comparison_by_group.csv` (MAE per `max_process_level` dan Reguler/Express),
  `ml/models/best_model.joblib` + `metadata.json`.
- Hasil dari data dummy ditulis ke `ml/reports/*_dummy.csv` dan **tidak boleh dilaporkan**.
- API memuat model dari `MODEL_PATH`; jika gagal, fiturnya tidak cocok, atau satuannya bukan
  `work_hours` (model lama), ETA memakai `promised_ready_at` (janji standar mitra).
- Model tidak di-commit. Setelah melatih ulang, salin `best_model.joblib` + `metadata.json` ke
  `/opt/gedklin/models/` di VM lalu restart `api` dan `worker`. Cek di Dasbor: "Model: ..." tidak
  boleh `janji-mitra`.
