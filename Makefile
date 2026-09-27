ifdef GNOROOT
	# If GNOROOT is already user defined, we need to override it with the
	# GNOROOT of the pinned gno module.
	# This is not required otherwise because the GNOROOT that originated the
	# binary is stored in a build flag.
	# (see -X github.com/gnolang/gno/gnovm/pkg/gnoenv._GNOROOT)
	GNOROOT = $(shell go list -f '{{.Module.Dir}}' github.com/gnolang/gno)
endif

REALM := gno.land/r/tbruyelle/gunslinger/v0

# Adena account addresses to premine on the local chain, space separated:
#   ADENA_ADDRS="g1... g1..." make gnodev
ADENA_ADDRS ?=

# --- Development ---

# Local chain: chain id "dev", RPC 127.0.0.1:26657, gnoweb 127.0.0.1:8888.
# No -empty-blocks: time.Now() inside a tx is the new block's time, so the
# realm's lazy timeouts work; only query-time clocks go stale.
gnodev:
	go tool gnodev $(foreach a,$(ADENA_ADDRS),-add-account $(a)=1000000000ugnot)

web:
	npm run dev -w client

dev:
	npx concurrently -n chain,web "$(MAKE) gnodev" "$(MAKE) web"

# --- Gno ---

test:
	go tool gno test ./gno.land/...

test-v:
	go tool gno test -v ./gno.land/...

lint:
	go tool gno lint ./gno.land/...

fmt:
	go tool gno fmt -w ./gno.land

# --- Client ---

check:
	npx tsc --noEmit -p client/tsconfig.json
	npm test -w client

# --- Generated data ---

# Regenerates the board A adjacency table for both the realm and the client.
gen-board:
	python3 scripts/gen_board_data.py

# --- Gno module cache ---

# Download gno module dependencies by starting a local gnodev from the pinned
# gno, so the cache (~/.config/gno/pkg/mod/) matches the pinned commit. The
# test-assertion helpers are imported only from *_test.gno files, so preload
# them explicitly for `gno mod download` to fetch them too.
mod-download:
	go tool gnodev -interactive=false -empty-blocks \
		-paths "gno.land/p/nt/uassert/v0,gno.land/p/nt/urequire/v0,gno.land/p/nt/testutils/v0,$(REALM)" </dev/null & \
	gnodev_pid=$$!; \
	trap "kill $$gnodev_pid 2>/dev/null" EXIT; \
	while ! curl -sf 'http://127.0.0.1:26657/abci_query?path=%22.app/version%22' 2>/dev/null | grep -q '"response"'; do \
		if ! kill -0 $$gnodev_pid 2>/dev/null; then echo "gnodev exited before becoming ready" >&2; exit 1; fi; \
		sleep 1; \
	done; \
	go tool gno clean -modcache=true; \
	go tool gno mod download -remote-overrides gno.land=http://127.0.0.1:26657

# --- Pin management ---

export FORK_REPO := github.com/gnolang/gno

# FORK_REF is what `make update-fork` re-pins to: a branch name, a tag, or a
# commit hash, handed to `go mod edit -replace` for `go mod tidy` to resolve
# into a pseudo-version. Run `make mod-download` afterwards.
FORK_REF ?= master

update-fork:
	@echo "pinning $(FORK_REPO) to '$(FORK_REF)'"
	go mod edit -replace github.com/gnolang/gno=$(FORK_REPO)@$(FORK_REF)
	go mod tidy
	go mod edit -replace github.com/gnolang/gno/contribs/gnodev=$(FORK_REPO)/contribs/gnodev@$(FORK_REF)
	go mod tidy

.PHONY: gnodev web dev test test-v lint fmt check gen-board mod-download update-fork
