.PHONY: setup clean test \
	postgres-up postgres-wait postgres-down postgres-logs \
	run-unit-tests run-unit-tests-postgres run-unit-tests-duckdb \
	run-integration-tests run-integration-tests-postgres run-integration-tests-duckdb \
	run-unit-tests-fusion run-integration-tests-fusion run-fusion-tests

# Nox 2026+ errors if both NO_COLOR and FORCE_COLOR are set (common in IDEs/CI).
UV_RUN_NOX = env -u NO_COLOR -u FORCE_COLOR -u CLICOLOR_FORCE uv run nox
UV_RUN_NOX_FUSION = $(UV_RUN_NOX) -f noxfile_fusion.py

# Nox session names (quoted for bash -lc recipes).
NOX_UNIT_PG_110 := unit_tests-3.12(adapter='postgres', uv_group='dbt-core-1-10')
NOX_UNIT_PG_111 := unit_tests-3.12(adapter='postgres', uv_group='dbt-core-1-11')
NOX_INT_PG_110 := integration_tests-3.12(adapter='postgres', uv_group='dbt-core-1-10')
NOX_INT_PG_111 := integration_tests-3.12(adapter='postgres', uv_group='dbt-core-1-11')

setup:
	uv sync

clean:
	rm -f ./*.duckdb
	rm -rf target logs dbt_packages

postgres-up:
	docker compose -f docker-compose.postgres.yml up -d postgres

postgres-wait:
	@started_at="$$(date +%s)"; \
	while true; do \
		state="$$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' dbt-package-template-postgres 2>/dev/null || true)"; \
		if [ "$$state" = "healthy" ]; then \
			exit 0; \
		fi; \
		if [ -z "$$state" ]; then \
			echo "Postgres container dbt-package-template-postgres was not created successfully." >&2; \
			exit 1; \
		fi; \
		if [ $$(( $$(date +%s) - $$started_at )) -ge 60 ]; then \
			echo "Timed out waiting for Postgres to become healthy." >&2; \
			exit 1; \
		fi; \
		sleep 1; \
	done

postgres-down:
	docker compose -f docker-compose.postgres.yml down --remove-orphans

postgres-logs:
	docker compose -f docker-compose.postgres.yml logs --no-color postgres

run-unit-tests-postgres:
	./scripts/run_with_postgres_container.sh \
		bash -lc "$(UV_RUN_NOX) -s \"$(NOX_UNIT_PG_110)\" && $(UV_RUN_NOX) -s \"$(NOX_UNIT_PG_111)\""

run-unit-tests-duckdb:
	$(UV_RUN_NOX) -s "unit_tests-3.12(adapter='duckdb', uv_group='dbt-core-1-10')"
	$(UV_RUN_NOX) -s "unit_tests-3.12(adapter='duckdb', uv_group='dbt-core-1-11')"

run-unit-tests: clean run-unit-tests-postgres
	$(MAKE) run-unit-tests-duckdb

run-unit-tests-fusion:
	./scripts/run_with_postgres_container.sh \
		$(UV_RUN_NOX_FUSION) -s fusion_unit_tests

run-integration-tests-postgres:
	./scripts/run_with_postgres_container.sh \
		bash -lc "$(UV_RUN_NOX) -s \"$(NOX_INT_PG_110)\" && $(UV_RUN_NOX) -s \"$(NOX_INT_PG_111)\""

run-integration-tests-duckdb:
	$(UV_RUN_NOX) -s "integration_tests-3.12(adapter='duckdb', uv_group='dbt-core-1-10')"
	$(UV_RUN_NOX) -s "integration_tests-3.12(adapter='duckdb', uv_group='dbt-core-1-11')"

run-integration-tests: clean run-integration-tests-postgres
	$(MAKE) run-integration-tests-duckdb

run-integration-tests-fusion:
	./scripts/run_with_postgres_container.sh \
		$(UV_RUN_NOX_FUSION) -s fusion_integration_tests

run-fusion-tests: run-unit-tests-fusion run-integration-tests-fusion

test: run-unit-tests run-integration-tests
