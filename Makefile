# Makefile for discord_complex_bot
# Supports Docker Compose (default) and local execution (DOCKER=0).

DOCKER ?= 1
COMPOSE ?= docker compose

.PHONY: help build-api run-api migrate test

help:
	@echo "Usage:"
	@echo "  make build-api   - Build the API / bot image"
	@echo "  make run-api     - Start the API / bot service"
	@echo "  make migrate     - Apply all database migrations"
	@echo "  make test        - Run test suite"

build-api:
ifeq ($(DOCKER),1)
	$(COMPOSE) build app
else
	pip install -e .
endif

run-api:
ifeq ($(DOCKER),1)
	$(COMPOSE) up -d app
else
	python -m app.main
endif

migrate:
ifeq ($(DOCKER),1)
	$(COMPOSE) run --rm --no-deps app alembic upgrade head
else
	alembic upgrade head
endif

test:
ifeq ($(DOCKER),1)
	$(COMPOSE) run --rm --no-deps app pytest -q
else
	pytest -q
endif
