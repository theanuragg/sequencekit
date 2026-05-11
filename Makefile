# SequenceKit — One-command build and demo setup
# Usage: make <target>
# Requires: Rust, Node 20+, Solana CLI, Anchor CLI

.PHONY: all setup build test deploy demo clean

# ── Full setup (first time) ────────────────────────────────────────────────────
setup:
	@echo "── Installing dependencies ──"
	cd packages/sdk && npm install
	cd apps/dashboard && npm install
	@echo "── Building SDK ──"
	cd packages/sdk && npm run build
	@echo "✅ Setup complete. Next: make build"

# ── Build everything ───────────────────────────────────────────────────────────
build: build-plugin build-program build-sdk
	@echo "✅ All components built"

build-plugin:
	@echo "── Building MakerShield BAM plugin ──"
	cd crates/maker-shield && cargo build --release
	@echo "✅ Plugin: target/release/libmaker_shield.so"

build-plugin-tee:
	@echo "── Building MakerShield with real TEE signing ──"
	cd crates/maker-shield && cargo build --release --features tee
	@echo "✅ Plugin (TEE): target/release/libmaker_shield.so"

build-program:
	@echo "── Building MicroCLOB Anchor program ──"
	cd crates/micro-clob && anchor build
	@echo "✅ Program built. IDL at: crates/micro-clob/target/idl/micro_clob.json"

build-sdk:
	@echo "── Building @sequencekit/sdk ──"
	cd packages/sdk && npm run build
	@echo "✅ SDK built"

# ── Tests ──────────────────────────────────────────────────────────────────────
test: test-plugin test-sdk
	@echo "✅ All tests passed"

test-plugin:
	@echo "── Running Rust unit tests ──"
	cd crates/maker-shield && cargo test

test-sdk:
	@echo "── Running TypeScript unit tests ──"
	cd packages/sdk && npm test

test-program:
	@echo "── Running Anchor integration tests (devnet) ──"
	cd crates/micro-clob && anchor test --provider.cluster devnet

# ── Deploy ─────────────────────────────────────────────────────────────────────
deploy-devnet:
	@echo "── Deploying MicroCLOB to devnet ──"
	cd crates/micro-clob && anchor deploy --provider.cluster devnet
	@echo "✅ Deployed. Run: make init-market"

init-market:
	@echo "── Initialising market on devnet ──"
	npx tsx scripts/init-market.ts

fund-demo:
	@echo "── Creating and funding demo wallets ──"
	npx tsx scripts/fund-demo-wallets.ts

# ── Dashboard ──────────────────────────────────────────────────────────────────
dev:
	@echo "── Starting dashboard on http://localhost:3000 ──"
	cd apps/dashboard && npm run dev

build-dashboard:
	cd apps/dashboard && npm run build

deploy-dashboard:
	cd apps/dashboard && npx vercel --prod

# ── Demo ───────────────────────────────────────────────────────────────────────
demo-maker:
	@echo "── Running maker demo (Terminal 1) ──"
	npx tsx scripts/demo-maker.ts

demo-taker:
	@echo "── Running taker demo (Terminal 2) ──"
	npx tsx scripts/demo-taker.ts

# ── Discriminators ─────────────────────────────────────────────────────────────
discriminators:
	@echo "── Verifying Anchor discriminators ──"
	npx tsx scripts/compute-discriminators.ts

# ── Publish SDK ────────────────────────────────────────────────────────────────
publish-sdk:
	cd packages/sdk && npm publish --access public

# ── Clean ──────────────────────────────────────────────────────────────────────
clean:
	rm -rf crates/maker-shield/target
	rm -rf crates/micro-clob/target
	rm -rf packages/sdk/dist
	rm -rf apps/dashboard/.next

# ── Help ───────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "SequenceKit — Make targets:"
	@echo ""
	@echo "  setup          Install all dependencies"
	@echo "  build          Build plugin + program + SDK"
	@echo "  test           Run all unit tests"
	@echo "  test-program   Run Anchor integration tests on devnet"
	@echo "  deploy-devnet  Deploy MicroCLOB to Solana devnet"
	@echo "  init-market    Create a market PDA on devnet"
	@echo "  fund-demo      Create and fund demo wallets"
	@echo "  dev            Start dashboard dev server"
	@echo "  demo-maker     Run maker demo script (Terminal 1)"
	@echo "  demo-taker     Run taker demo script (Terminal 2)"
	@echo "  discriminators Verify Anchor discriminators"
	@echo "  publish-sdk    Publish @sequencekit/sdk to npm"
	@echo ""

shredstream:
	@echo "── ShredStream connection test ──"
	npx tsx scripts/apply-shredstream.ts
