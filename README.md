# Gedklin (SmartWash AI)

Platform manajemen operasional laundry kiloan untuk mitra **Gedklin Laundry, Medan**:
kasir/POS, prediksi waktu siap diambil berbasis ML, notifikasi WhatsApp terbatas,
dasbor pemilik, dan portal tracking pelanggan (PWA).


## Struktur

```
apps/api   FastAPI + SQLAlchemy + Alembic + Celery (antrean, ETA, notifikasi)
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
pip install -r apps/api/requirements-dev.txt

# 3. Model (pakai data dummy sampai data mitra terkumpul)
cd ml && python scripts/generate_dummy.py && python scripts/train_compare.py && cd ..

# 4. API
cd apps/api
cp .env.example .env            # isi SEED_OWNER_PASSWORD dan JWT_SECRET
alembic upgrade head
python -m app.seed              # layanan CK/CKS + akun owner
uvicorn app.main:app --reload   # http://localhost:8000/docs

# 5. Worker + beat (terminal lain). Tanpa Redis: set CELERY_TASK_ALWAYS_EAGER=true di .env
celery -A app.workers worker -B --loglevel=info

# 6. Web (terminal lain)
cd apps/web && cp .env.example .env.local && npm install && npm run dev   # http://localhost:3000
```

Halaman: `/login`, `/kasir`, `/dasbor` (+ `/operasional`, `/layanan`, `/akun`), `/admin`,
`/lacak` dan `/lacak/<kode>` (publik).

## Test & lint

```bash
cd apps/api && pytest                     # SQLite; set TEST_DATABASE_URL untuk Postgres
ruff check apps/api ml && ruff format --check apps/api ml
cd apps/web && npm run lint && npx tsc --noEmit && npm run build
```

## Data & model

- Data mitra disimpan di `ml/data/raw/orders.csv` dan `ml/data/raw/daily.csv` (tidak di-commit).
  Jika ada, script otomatis memakainya; jika tidak, memakai `*_dummy.csv`.
- `train_compare.py` membandingkan baseline median, Linear Regression, Random Forest, dan XGBoost
  dengan split berbasis waktu, lalu menyimpan `ml/models/best_model.joblib` + `metadata.json`.
- Hasil dari data dummy ditulis ke `ml/reports/comparison_dummy.csv` dan **tidak boleh dilaporkan**.
- API memuat model dari `MODEL_PATH`; jika gagal, otomatis fallback ke baseline median.
