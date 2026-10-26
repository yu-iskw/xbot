.PHONY: install build typecheck lint format test check dev

install:
	pnpm install

build:
	pnpm build

typecheck: build
	pnpm typecheck

lint:
	pnpm lint

format:
	pnpm format

test:
	pnpm test

check: lint typecheck test

dev:
	pnpm --filter @xbot/dev dev
