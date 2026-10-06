# discord_complex_bot

Многофункциональный Discord-бот: музыка через Lavalink, модерация, веб-панель управления с авторизацией через Discord.

## Архитектура

```
[Web UI (React SPA)] ──HTTP──▶ [FastAPI ─┐
[Discord клиенты]  ──Gateway─▶  discord.py ├─▶ [SQLite (настройки, сессии, аудит)]
                                Lavalink-клиент ──WS/HTTP──▶ [Lavalink (Docker)] ──▶ YouTube/SoundCloud
                                             └─Voice UDP──▶ Discord голосовые каналы
```

- **Бот** (`app/bot/`) — discord.py 2.x, slash-команды в cogs (модули: `music`, `moderation`, `owner`).
- **Музыка** — Lavalink v4 (отдельный контейнер) + клиент [wavelink](https://github.com/PythonistaGuild/Wavelink). Очереди — в памяти, управляются и slash-командами, и веб-панелью через общий `MusicService` (`app/core/services/music.py`).
- **API** (`app/api/`) — FastAPI: OAuth2-авторизация Discord, сессии, REST для плеера и админки.
- **Фронт** (`web/`) — Vite + React + TS, собирается в `app/static` и раздаётся FastAPI в проде.
- **БД** (`app/core/db/`) — SQLite + SQLAlchemy 2.0 (async), миграции — Alembic.

### Роли в веб-панели

| Роль | Кто это | Что может |
|------|---------|-----------|
| super-admin | ID из `SUPERADMIN_IDS` (это вы) | Всё: все серверы бота, настройки, аварийный доступ |
| guild-admin | Владелец сервера, право `Manage Guild`, или добавлен в `guild_admins` через панель | Управление настройками и админами своего сервера |
| user | Участник сервера | Управление музыкой (очередь, пауза, скипы) |

## Настройка Discord-приложения

1. [Discord Developer Portal](https://discord.com/developers/applications) → ваше приложение:
   - **Bot** → Reset Token → скопируйте токен → `DISCORD_BOT_TOKEN`. Включите intent **Server Members** не требуется, достаточно дефолтных.
   - **OAuth2** → скопируйте **Client ID** → `DISCORD_CLIENT_ID` и **Client Secret** → `DISCORD_CLIENT_SECRET`.
   - **OAuth2 → Redirects** → добавьте `http://localhost:8000/api/auth/callback` (для прода — ваш домен: `https://ваш-домен/api/auth/callback`).
2. Ссылка для приглашения бота на сервер (замените `CLIENT_ID`):
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=277025508352
   ```
   Права включают: просмотр каналов, подключение к голосу, говор, отправку сообщений, встраивание, управление сообщениями, kick/ban (для будущей модерации).
3. Ваш Discord user ID (ПКМ по себе → Copy ID при включённом Developer Mode) → `SUPERADMIN_IDS`.

## Запуск

### Docker (рекомендуется)

```bash
cp .env.example .env
# заполните .env (токены, секреты). Пароль Lavalink задайте в LAVALINK_PASSWORD.
docker compose up -d --build
# панель: http://localhost:8000
```

### Локально (разработка)

```bash
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"       # Windows Git Bash; на Linux/macOS: .venv/bin/pip

# 1. Lavalink (нужен Docker или локальная Java 17+):
docker run -d --name lavalink -p 2333:2333 \
  -e LAVALINK_PASSWORD=change-me-too \
  -v "$(pwd)/lavalink/application.yml:/opt/Lavalink/application.yml:ro" \
  ghcr.io/lavalink-devs/lavalink:4

# 2. Бот + API одним процессом:
.venv/Scripts/python -m app.main

# 3. Фронт в dev-режиме (hot reload, прокси на :8000):
cd web && npm install && npm run dev       # http://localhost:5173
```

Миграции БД (в рантайме выполняются автоматически, вручную — для прод-процессов):

```bash
.venv/Scripts/alembic upgrade head
```

## Переменные окружения

См. `.env.example` — все переменные с комментариями.

## Структура проекта

```
app/
  bot/            # discord.py клиент + cogs
    cogs/music.py, moderation.py, owner.py
  api/            # FastAPI
    routers/auth.py, player.py, admin.py
    discord_oauth.py, sessions.py, deps.py
  core/           # общее ядро
    config.py, db/ (модели, миграции), services/music.py
  main.py         # точка входа: бот + API в одном asyncio-цикле
  static/         # собранный фронт (git-ignored)
web/              # исходники SPA
lavalink/         # конфиг Lavalink
alembic/          # миграции БД
```

## Roadmap

- [x] v1: скелет, музыка (slash + web), OAuth2-панель, роли, Docker
- [ ] Полноценная модерация: mute/timeout, варны, лог-каналы
- [ ] Создание постов/тредов (форумы), расписания
- [ ] Плейлисты и «избранное» в БД, история прослушиваний
- [ ] PostgreSQL при росте, метрики
