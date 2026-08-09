ifeq ($(OS),Windows_NT)
SHELL := bash.exe
BASH_RUN := bash.exe --login
else
SHELL := bash
BASH_RUN := bash
endif
.DEFAULT_GOAL := help

.PHONY: help bootstrap up down reset seed dev test lint secret-scan e2e m4-live m5-live m5-ui-live m6-live m6-ui-live m6-load m6-restore check

help:
	@printf '%s\n' \
	  'AutoPay Guard development commands:' \
	  '  make bootstrap  validate tools, create .env, and install dependencies' \
	  '  make up         build and start the complete local stack' \
	  '  make down       stop the local stack without deleting data' \
	  '  make reset      stop the stack and delete local development data' \
	  '  make seed       verify deterministic fake-local M1-M6 baseline' \
	  '  make dev        start infrastructure plus API/web hot reload' \
	  '  make test       run backend and frontend tests' \
	  '  make lint       run formatting, lint, and type checks' \
	  '  make secret-scan scan exactly the intended Git source set for secrets' \
	  '  make e2e        run the Playwright smoke suite against the local stack' \
	  '  make m4-live    run guarded fake-local Milestone 4 live acceptance' \
	  '  make m5-live    run guarded fake-local Milestone 5 live acceptance' \
	  '  make m5-ui-live run guarded real-OIDC Milestone 5 desktop/mobile acceptance' \
	  '  make m6-live    run guarded fake-local Milestone 6 import acceptance' \
	  '  make m6-ui-live run guarded real-OIDC Milestone 6 desktop/mobile acceptance' \
	  '  make m6-load    run the bounded fake-local Milestone 6 load hypothesis' \
	  '  make m6-restore run the non-destructive fake-local PostgreSQL restore drill' \
	  '  make check      run the complete current-milestone quality gate'

bootstrap:
	@$(BASH_RUN) scripts/bootstrap.sh

up:
	@$(BASH_RUN) scripts/compose.sh up

down:
	@$(BASH_RUN) scripts/compose.sh down

reset:
	@$(BASH_RUN) scripts/reset.sh --yes

seed:
	@$(BASH_RUN) scripts/seed.sh

dev:
	@$(BASH_RUN) scripts/dev.sh

test:
	@$(BASH_RUN) scripts/quality.sh test

lint:
	@$(BASH_RUN) scripts/quality.sh lint

secret-scan:
	@$(BASH_RUN) scripts/quality.sh secret-scan

e2e:
	@$(BASH_RUN) scripts/quality.sh e2e

m4-live:
	@$(BASH_RUN) scripts/m4-live.sh

m5-live:
	@$(BASH_RUN) scripts/m5-live.sh

m5-ui-live:
	@$(BASH_RUN) scripts/m5-ui-live.sh

m6-live:
	@$(BASH_RUN) scripts/m6-live.sh

m6-ui-live:
	@$(BASH_RUN) scripts/m6-ui-live.sh

m6-load:
	@$(BASH_RUN) scripts/m6-load.sh

m6-restore:
	@$(BASH_RUN) scripts/m6-restore.sh

check:
	@$(BASH_RUN) scripts/quality.sh check
