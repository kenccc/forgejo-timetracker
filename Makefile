.PHONY: dev prod down down-prod logs logs-prod shell migrate build help

dev: ## Start dev server (hot reload, port 8000)
	docker compose up --build

prod: ## Start production stack (Caddy + gunicorn)
	docker compose -f docker-compose.prod.yml up -d --build

down: ## Stop dev containers
	docker compose down

down-prod: ## Stop prod containers
	docker compose -f docker-compose.prod.yml down

logs: ## Tail dev web logs
	docker compose logs -f web

logs-prod: ## Tail prod web logs
	docker compose -f docker-compose.prod.yml logs -f web

shell: ## Django shell (dev)
	docker compose exec web python manage.py shell

migrate: ## Run migrations (dev)
	docker compose exec web python manage.py migrate

build: ## Build image only
	docker compose build

help: ## Show help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
