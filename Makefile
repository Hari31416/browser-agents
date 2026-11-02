SHELL := /bin/bash

# Load environment variables from .env file if it exists
ifneq (,$(wildcard .env))
    include .env
    export
endif

PNPM ?= /opt/homebrew/bin/pnpm
export PATH := /opt/homebrew/bin:$(PATH)
ROOT_DIR := $(CURDIR)
BACKEND_DIR := $(ROOT_DIR)/backend
FRONTEND_DIR := $(ROOT_DIR)/apps/demo
RUN_DIR := $(ROOT_DIR)/.run

RELAY_HOST ?= 127.0.0.1
RELAY_PORT ?= 8765
FRONTEND_PORT ?= 5173

RELAY_PID := $(RUN_DIR)/relay.pid
FRONTEND_PID := $(RUN_DIR)/frontend.pid
RELAY_LOG := $(RUN_DIR)/relay.log
FRONTEND_LOG := $(RUN_DIR)/frontend.log

.DEFAULT_GOAL := help

.PHONY: help setup start stop restart app-start app-stop app-restart \
	start-relay stop-relay start-frontend stop-frontend \
	dev relay frontend status health logs logs-relay logs-frontend clean-logs \
	check test test-backend test-workspace test-python test-python-browser test-runtime test-demo typecheck format format-check build clean

help:
	@echo "Browser Agents - Available Commands"
	@echo "==================================="
	@echo ""
	@echo "Full Stack (Background):"
	@echo "  make start            - Start demo frontend in background"
	@echo "  make stop             - Stop all background services"
	@echo "  make restart          - Restart all background services"
	@echo ""
	@echo "Services (Background):"
	@echo "  make start-relay      - Start model relay in background"
	@echo "  make stop-relay       - Stop model relay"
	@echo "  make start-frontend   - Start demo frontend in background"
	@echo "  make stop-frontend    - Stop demo frontend"
	@echo ""
	@echo "Interactive Development (Foreground):"
	@echo "  make dev              - Run demo frontend in foreground"
	@echo "  make relay            - Run model relay in foreground"
	@echo "  make frontend         - Run demo frontend in foreground"
	@echo ""
	@echo "Logs & Status:"
	@echo "  make status           - Show process status and running PIDs"
	@echo "  make health           - Health check for model relay API"
	@echo "  make logs             - Show log file paths"
	@echo "  make logs-relay       - View model relay logs (follow)"
	@echo "  make logs-frontend    - View demo frontend logs (follow)"
	@echo "  make clean-logs       - Remove local log files"
	@echo ""
	@echo "Quality & Testing:"
	@echo "  make check            - Run format check, typecheck, and all test suites"
	@echo "  make test             - Run all test suites"
	@echo "  make test-backend     - Run backend pytest suite"
	@echo "  make test-workspace   - Run workspace storage and staging test suite"
	@echo "  make test-python      - Run Python protocol and staging integration tests"
	@echo "  make test-python-browser - Run Python browser Playwright verification tests"
	@echo "  make test-runtime     - Run runtime package tests"
	@echo "  make test-demo        - Run chat demo UI and workflow verification suite"
	@echo "  make typecheck        - Run TypeScript compiler checks"
	@echo "  make format           - Format backend Python code with black"
	@echo "  make format-check     - Check backend Python formatting"
	@echo ""
	@echo "Build & Setup:"
	@echo "  make setup            - Install frontend dependencies"
	@echo "  make build            - Build all TypeScript packages and demo app"
	@echo "  make clean            - Remove build artifacts and temporary files"
	@echo "  make docker-build     - Build relay and frontend container images"
	@echo "  make docker-up        - Start containers in background with docker compose"
	@echo "  make docker-down      - Stop containers with docker compose"

# ---------------------------------------------------------------------------
# Setup & Build
# ---------------------------------------------------------------------------

setup:
	$(PNPM) run setup

build:
	$(PNPM) run build

clean: clean-logs
	rm -rf packages/*/dist packages/*/*.tsbuildinfo apps/*/dist apps/*/*.tsbuildinfo

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

# ---------------------------------------------------------------------------
# Foreground Development
# ---------------------------------------------------------------------------

dev:
	$(PNPM) run dev

relay:
	cd $(BACKEND_DIR) && PYTHONPATH=src .venv/bin/uvicorn relay.main:app --host $(RELAY_HOST) --port $(RELAY_PORT) --reload

frontend:
	cd $(FRONTEND_DIR) && ./node_modules/.bin/vite --host $(RELAY_HOST) --port $(FRONTEND_PORT)

# ---------------------------------------------------------------------------
# Background Process Management
# ---------------------------------------------------------------------------

start: start-frontend

stop: stop-frontend stop-relay

restart: stop start

app-start: start
app-stop: stop
app-restart: restart

start-relay:
	@mkdir -p $(RUN_DIR)
	@if [ -f $(RELAY_PID) ] && kill -0 $$(cat $(RELAY_PID)) 2>/dev/null; then \
		echo "Model relay already running with PID $$(cat $(RELAY_PID))"; \
	else \
		cd $(BACKEND_DIR) && PYTHONPATH=src nohup .venv/bin/uvicorn relay.main:app --host $(RELAY_HOST) --port $(RELAY_PORT) > $(RELAY_LOG) 2>&1 & echo $$! > $(RELAY_PID); \
		sleep 0.5; \
		if [ -f $(RELAY_PID) ] && kill -0 $$(cat $(RELAY_PID)) 2>/dev/null; then \
			echo "Model relay started in background (PID: $$(cat $(RELAY_PID)))"; \
		else \
			echo "Model relay failed to start. Check $(RELAY_LOG):"; \
			tail -n 20 $(RELAY_LOG); \
			exit 1; \
		fi \
	fi

stop-relay:
	@stopped=0; \
	if [ -f $(RELAY_PID) ]; then \
		PID=$$(cat $(RELAY_PID)); \
		if kill -0 $$PID 2>/dev/null; then \
			kill $$PID 2>/dev/null || true; \
			sleep 0.2; \
			kill -9 $$PID 2>/dev/null || true; \
			stopped=1; \
		fi; \
		rm -f $(RELAY_PID); \
	fi; \
	PORT_PIDS=$$(lsof -ti :$(RELAY_PORT) -sTCP:LISTEN 2>/dev/null); \
	if [ -n "$$PORT_PIDS" ]; then \
		echo "$$PORT_PIDS" | xargs kill 2>/dev/null || true; \
		sleep 0.2; \
		echo "$$PORT_PIDS" | xargs kill -9 2>/dev/null || true; \
		stopped=1; \
	fi; \
	if [ $$stopped -eq 1 ]; then \
		echo "Model relay stopped"; \
	else \
		echo "Model relay not running"; \
	fi

start-frontend:
	@mkdir -p $(RUN_DIR)
	@if [ -f $(FRONTEND_PID) ] && kill -0 $$(cat $(FRONTEND_PID)) 2>/dev/null; then \
		echo "Demo frontend already running with PID $$(cat $(FRONTEND_PID))"; \
	else \
		cd $(FRONTEND_DIR) && nohup ./node_modules/.bin/vite --host $(RELAY_HOST) --port $(FRONTEND_PORT) </dev/null > $(FRONTEND_LOG) 2>&1 & echo $$! > $(FRONTEND_PID); \
		sleep 0.5; \
		if [ -f $(FRONTEND_PID) ] && kill -0 $$(cat $(FRONTEND_PID)) 2>/dev/null; then \
			echo "Demo frontend started in background (PID: $$(cat $(FRONTEND_PID)))"; \
		else \
			echo "Demo frontend failed to start. Check $(FRONTEND_LOG):"; \
			tail -n 20 $(FRONTEND_LOG); \
			exit 1; \
		fi \
	fi

stop-frontend:
	@stopped=0; \
	if [ -f $(FRONTEND_PID) ]; then \
		PID=$$(cat $(FRONTEND_PID)); \
		if kill -0 $$PID 2>/dev/null; then \
			kill $$PID 2>/dev/null || true; \
			sleep 0.2; \
			kill -9 $$PID 2>/dev/null || true; \
			stopped=1; \
		fi; \
		rm -f $(FRONTEND_PID); \
	fi; \
	PORT_PIDS=$$(lsof -ti :$(FRONTEND_PORT) -sTCP:LISTEN 2>/dev/null); \
	if [ -n "$$PORT_PIDS" ]; then \
		echo "$$PORT_PIDS" | xargs kill 2>/dev/null || true; \
		sleep 0.2; \
		echo "$$PORT_PIDS" | xargs kill -9 2>/dev/null || true; \
		stopped=1; \
	fi; \
	if [ $$stopped -eq 1 ]; then \
		echo "Demo frontend stopped"; \
	else \
		echo "Demo frontend not running"; \
	fi

status:
	@printf "%-18s" "Model relay:"
	@PORT_PID=$$(lsof -ti :$(RELAY_PORT) -sTCP:LISTEN 2>/dev/null); \
	if [ -n "$$PORT_PID" ]; then \
		echo "running (PID $$PORT_PID) on http://$(RELAY_HOST):$(RELAY_PORT)"; \
	elif [ -f $(RELAY_PID) ] && kill -0 $$(cat $(RELAY_PID)) 2>/dev/null; then \
		echo "running (PID $$(cat $(RELAY_PID))) on http://$(RELAY_HOST):$(RELAY_PORT)"; \
	else \
		echo "stopped"; \
	fi
	@printf "%-18s" "Demo frontend:"
	@PORT_PID=$$(lsof -ti :$(FRONTEND_PORT) -sTCP:LISTEN 2>/dev/null); \
	if [ -n "$$PORT_PID" ]; then \
		echo "running (PID $$PORT_PID) on http://$(RELAY_HOST):$(FRONTEND_PORT)"; \
	elif [ -f $(FRONTEND_PID) ] && kill -0 $$(cat $(FRONTEND_PID)) 2>/dev/null; then \
		echo "running (PID $$(cat $(FRONTEND_PID))) on http://$(RELAY_HOST):$(FRONTEND_PORT)"; \
	else \
		echo "stopped"; \
	fi

health:
	@curl -fsS --noproxy "*" http://$(RELAY_HOST):$(RELAY_PORT)/api/health || (echo "Relay health check failed" && exit 1)
	@echo "Relay is healthy"

logs:
	@echo "Relay log:    $(RELAY_LOG)"
	@echo "Frontend log: $(FRONTEND_LOG)"

logs-relay:
	@touch $(RELAY_LOG)
	@tail -n 100 -f $(RELAY_LOG)

logs-frontend:
	@touch $(FRONTEND_LOG)
	@tail -n 100 -f $(FRONTEND_LOG)

clean-logs:
	rm -rf $(RUN_DIR)

# ---------------------------------------------------------------------------
# Quality & Testing
# ---------------------------------------------------------------------------

format:
	$(PNPM) run format

format-check:
	$(PNPM) run format:check

typecheck:
	$(PNPM) run typecheck

test-backend:
	$(PNPM) run test:backend

test-workspace:
	$(PNPM) run test:workspace

test-python:
	$(PNPM) run test:python

test-python-browser:
	$(PNPM) run test:python:browser

test-runtime:
	$(PNPM) run test:runtime

test-demo:
	$(PNPM) run test:demo

test:
	$(PNPM) run test:backend
	$(PNPM) run test:workspace
	$(PNPM) run test:python
	$(PNPM) run test:runtime
	$(PNPM) run test:demo

check: format-check typecheck test
