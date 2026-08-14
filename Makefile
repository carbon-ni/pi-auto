.PHONY: all lint format test clean

all: lint format test

lint:
	npm run lint

format:
	npm run format:check

test:
	npm test

coverage:
	npx vitest run --coverage

clean:
	rm -rf coverage dist
