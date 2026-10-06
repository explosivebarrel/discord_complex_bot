# --- Stage 1: build the web SPA ---
FROM node:22-alpine AS web
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: python app ---
FROM python:3.12-slim AS runtime
WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml ./
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY --from=web /app/static ./app/static

RUN pip install --no-cache-dir .

EXPOSE 8000
CMD ["python", "-m", "app.main"]
