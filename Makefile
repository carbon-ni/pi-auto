.PHONY: all lint test clean

all: lint test

lint:
	npm run lint

test:
	npm test

coverage:
	npx vitest run --coverage

clean:
	rm -rf coverage dist
