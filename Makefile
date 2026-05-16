.PHONY: all lint test clean

all: lint test

lint:
	npm run lint

test:
	npm test

clean:
	rm -rf coverage dist
