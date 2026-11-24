# Gedklin (SmartWash AI)

Platform manajemen operasional laundry kiloan untuk mitra **Gedklin Laundry, Medan**:
kasir/POS, penjadwalan antrean cucian (Least Slack Time), notifikasi WhatsApp terbatas,
dasbor pemilik dengan analisis laporan berbasis AI, dan portal tracking pelanggan (PWA).


## Struktur

```
apps/api   FastAPI + SQLAlchemy + Alembic + Celery (harga, janji waktu, penjadwalan antrean, notifikasi, analisis AI)
apps/web   Next.js 16 (App Router, TypeScript strict): kasir, antrean cucian (staff), dasbor, portal /lacak (PWA)
infra/     docker-compose (Postgres + Redis; profil `app` untuk semua service)
```

## Menjalankan secara lokal

Prasyarat: Python 3.11, Node 22+, Docker (atau Postgres 16 + Redis lokal).

```bash
# 1. Database & Redis
docker compose -f infra/docker-compose.yml up -d

# 2. Python env
python3.11 -m venv .venv && source .venv/bin/activate
(cd apps/api && pip install -r requirements-dev.txt)

# 3. API
cd apps/api
cp .env.example .env            # isi SEED_OWNER_PASSWORD dan JWT_SECRET (lihat di bawah)
alembic upgrade head
python -m app.seed              # katalog harga, janji waktu, pengaturan + akun owner
uvicorn app.main:app --reload   # http://localhost:8000/docs

# 4. Worker + beat (terminal lain). Tanpa Redis: set CELERY_TASK_ALWAYS_EAGER=true di .env
celery -A app.workers worker -B --loglevel=info

# 5. Web (terminal lain)
cd apps/web && cp .env.example .env.local && npm install && npm run dev   # http://localhost:3000
```

### Windows (PowerShell)

Jalankan dari root repo. Docker Desktop harus sudah menyala.

```powershell
# 1. Database & Redis
docker compose -f infra/docker-compose.yml up -d

# 2. Python env
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
# Jika muncul error "running scripts is disabled", jalankan sekali:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
cd apps/api; pip install -r requirements-dev.txt; cd ../..

# 3. API
cd apps/api
Copy-Item .env.example .env     # isi SEED_OWNER_PASSWORD dan JWT_SECRET (lihat di bawah)
alembic upgrade head
python -m app.seed              # katalog harga, janji waktu, pengaturan + akun owner
uvicorn app.main:app --reload   # http://localhost:8000/docs

# 4a. Worker (terminal lain, aktifkan .venv dulu, dari apps/api)
#     Windows tidak mendukung pool prefork maupun opsi -B, jadi pakai --pool=solo
#     dan jalankan beat terpisah. Tanpa Redis: set CELERY_TASK_ALWAYS_EAGER=true di .env
celery -A app.workers worker --pool=solo --loglevel=info

# 4b. Beat / jadwal berkala (terminal lain, aktifkan .venv dulu, dari apps/api)
celery -A app.workers beat --loglevel=info

# 5. Web (terminal lain, dari root repo)
cd apps/web
Copy-Item .env.example .env.local
npm install
npm run dev                     # http://localhost:3000
```

Di terminal baru, aktifkan venv dengan `.\.venv\Scripts\Activate.ps1` (dari root repo) sebelum
menjalankan `uvicorn` atau `celery`. Kalau pakai Command Prompt (cmd), aktivasinya
`.venv\Scripts\activate.bat` dan ganti `Copy-Item` dengan `copy`.

Halaman: `/login`, `/kasir`, `/dasbor` (+ `/operasional`, `/layanan`, `/akun`), `/pengaturan`, `/tindak-lanjut`, `/antrean`,
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
ruff check apps/api && ruff format --check apps/api
cd apps/web && npm run lint && npx tsc --noEmit && npm run build
```

## Harga & janji waktu

- Price list awal mitra ada di `apps/api/seed/price_catalog.json`. `python -m app.seed` mengisinya ke
  `service_catalog` **hanya bila katalog masih kosong** (janji per proses di file itu menjadi janji
  awal tiap layanan), plus `app_settings` yang belum ada. Setelah itu pemilik mengelola layanan di
  `/dasbor/layanan`: tambah, ubah (nama, kelompok, proses, satuan, harga, aturan min/maks, Bisa
  Express, lama kerja, janji Reguler/Express), nonaktifkan, dan hapus. Layanan
  yang sudah dipakai di pesanan tidak bisa dihapus, cukup dinonaktifkan. Item dry clean belum punya
  harga, jadi nonaktif sampai harganya diisi.
- `/pengaturan` mengumpulkan semua pengaturan: akun sendiri (nama, password) untuk semua peran, dan
  khusus pemilik: profil outlet (nama/alamat/telepon di nota, WA, dan lacak), jadwal normal,
  penjadwalan antrean (kapasitas mesin dan lama siklus), pengali Express, janji waktu, serta
  penyedia dan API key AI. Libur atau mesin rusak per tanggal dicatat di Jadwal Outlet (`/dasbor/operasional`).
- Semua aturan harga (kiloan: harga 7 kg pertama + tambahan per kg untuk sisa berat, minimal kg,
  per pcs, per load item khusus, Express = Reguler × `express_multiplier` hanya untuk item
  `express_eligible` yaitu CKL dan CKS) ada di `apps/api/app/services/pricing.py`.
  Form kasir memanggil `POST /orders/quote`, jadi aturan harga tidak diduplikasi di frontend.
- Load mesin (`machine_loads = ceil(kg / machine_capacity_kg)`, default 8 kg) dipakai penjadwalan
  antrean, terpisah dari harga.
- Perkiraan siap di nota, `/lacak`, dan WhatsApp = janji standar layanan (`promised_ready_at`):
  jam janji terpanjang dari item di pesanan, hari tutup tidak dihitung.
- Status pesanan: `RECEIVED → PROCESSING → READY → PICKED_UP`, plus `CANCELLED` (dengan alasan,
  sebelum siap dan belum lunas). Tandai Diambil wajib lunas; pembayaran dicatat tunai/QRIS/transfer.
- Pemilik: `/dasbor/laporan` (per periode, per layanan/kasir/metode bayar, unduh CSV) dan
  `/dasbor/log`. Kasir dan pemilik: `/pelanggan` (riwayat, tagihan belum lunas, ubah data).
- Login dikunci 15 menit setelah 5 kali salah per username; petugas bisa ganti password sendiri.

## Penjadwalan antrean (Least Slack Time)

Urutan di papan kasir dan layar Antrean Cucian dihitung di `apps/api/app/services/queue.py`:

```
slack = sisa jam kerja sampai janji siap - taksiran waktu proses
```

- Waktu proses ditaksir dari berat: jumlah load mesin dibagi mesin cuci/pengering yang tersedia
  hari itu, dikali lama satu siklus, ditambah setrika manual (per kg atau per pcs) dibagi petugas
  yang bertugas. Kapasitas mesin dan lama siklus diatur pemilik di `/pengaturan` → Penjadwalan
  antrean (bawaan 60/60 menit per load, 10 menit/kg, 5 menit/pcs; menunggu angka dari mitra).
- Sisa waktu dihitung dalam jam buka outlet, jadi malam dan hari tutup tidak dihitung. Pesanan
  yang sudah lewat janji punya slack negatif dan paling atas.
- Slack terkecil dikerjakan duluan. Pesanan berat yang janjinya dekat naik ke atas walaupun janji
  pesanan ringan lebih awal. Express tidak punya jalur khusus: janjinya yang lebih pendek otomatis
  membuat slack-nya kecil.
- Mencuci tidak bisa disela, jadi pesanan berstatus Diproses selalu tetap di depan.
- Layar Antrean Cucian menampilkan taksiran proses dan sisa kelonggaran tiap pesanan.

## Pengujian analisis AI

- `tests/test_ai_data.py` memakai pesanan uji yang hasilnya dihitung tangan, lalu memastikan data
  yang dikirim ke AI (total, per hari, per layanan, ketepatan waktu, dsb.) sama persis, prompt yang
  terkirim memuat data itu tanpa nama/nomor pelanggan, dan pemeriksa angka
  (`app/services/ai_check.py`) menandai angka yang dikarang AI.
- Untuk laporan, uji AI sungguhan (memakai API key di Pengaturan AI) pada data di database:

  ```bash
  cd apps/api
  python -m app.uji_ai --mulai 2026-10-01 --akhir 2026-10-31 --ulang 5 --keluaran hasil-uji-ai.md
  ```

  Hasilnya tabel Markdown: berapa angka yang disebut AI di tiap percobaan, berapa yang sesuai data,
  daftar angka yang tidak ditemukan di data, waktu respons, dan lampiran jawaban AI. Hasil uji tidak
  masuk riwayat analisis.
- Batasan tugas: system prompt melarang AI menulis kode atau menjawab di luar data laporan, dan
  meminta balasan `DI_LUAR_TOPIK`. Server juga menolak jawaban yang berisi penanda itu atau kode
  program (`off_topic` di `ai_check.py`), sehingga tidak masuk riwayat. Uji untuk laporan:
  `python -m app.uji_ai --mulai ... --akhir ... --uji-batasan` (8 skenario: membuat aplikasi,
  menulis kode, puisi, pengetahuan umum, data pribadi, perintah mengabaikan aturan, dan 2 kontrol).
