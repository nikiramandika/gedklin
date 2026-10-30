# Build context: root repo (butuh paket ml/gedklin_ml bersama).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv

COPY ml/pyproject.toml ml/pyproject.toml
COPY ml/gedklin_ml ml/gedklin_ml
COPY apps/api/requirements.txt apps/api/requirements.txt
# `-e ../../ml` di requirements.txt dibaca relatif terhadap cwd, jadi install dari apps/api.
WORKDIR /srv/apps/api
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
