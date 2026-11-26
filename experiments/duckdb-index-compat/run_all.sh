#!/usr/bin/env bash
set -euo pipefail

# DuckDB Index Compatibility Experiment
# Tests whether HNSW and FTS indexes created by Python are usable from Rust (and vice versa).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
RUST_DIR="$SCRIPT_DIR/rust_side"
# Use local uv venv (pyproject.toml pins duckdb==2.0.1 to match the Rust crate)
py() { uv run --directory "$SCRIPT_DIR" python "$@"; }
SHARED_DIR="$SCRIPT_DIR/shared"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

passed=0
failed=0
errors=()

log() { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; }
pass() { echo -e "  ${GREEN}✓ PASS${NC}: $1"; ((passed++)) || true; }
fail() { echo -e "  ${RED}✗ FAIL${NC}: $1"; ((failed++)) || true; errors+=("$1"); }

# Clean up previous results
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

# Clean up previous test databases
rm -f /tmp/compat_test*.duckdb /tmp/compat_test*.duckdb.wal

# ── Step 0: Build Rust binary & report versions ─────────────────────────────

log "Building Rust binary..."
(cd "$RUST_DIR" && cargo build --release 2>&1 | tail -1)
RUST_BIN="$RUST_DIR/target/release/duckdb-index-compat"

log "Generating test data (query vectors)..."
py "$SHARED_DIR/test_data.py" /tmp/test_chunks.parquet

log ""
log "═══════════════════════════════════════════════════════════════"
log "  Version Report"
log "═══════════════════════════════════════════════════════════════"
py "$SCRIPT_DIR/python_side.py" report-versions | tee "$RESULTS_DIR/versions_python.json"
$RUST_BIN report-versions | tee "$RESULTS_DIR/versions_rust.json"
log ""

# ── Test 1: Python creates everything, Python reads ─────────────────────────

log "═══════════════════════════════════════════════════════════════"
log "  Test 1: Python → Python (baseline)"
log "═══════════════════════════════════════════════════════════════"

DB1="/tmp/compat_test1.duckdb"
py "$SCRIPT_DIR/python_side.py" create-schema "$DB1" >/dev/null
py "$SCRIPT_DIR/python_side.py" write-data "$DB1" >/dev/null
py "$SCRIPT_DIR/python_side.py" create-hnsw "$DB1" >/dev/null
py "$SCRIPT_DIR/python_side.py" create-fts "$DB1" >/dev/null
py "$SCRIPT_DIR/python_side.py" query-hnsw "$DB1" > "$RESULTS_DIR/test1_py_hnsw.json"
py "$SCRIPT_DIR/python_side.py" query-fts "$DB1" > "$RESULTS_DIR/test1_py_fts.json"
py "$SCRIPT_DIR/python_side.py" check-indexes "$DB1" > "$RESULTS_DIR/test1_indexes.json"

# Validate baseline
if grep -q '"top1_match": true' "$RESULTS_DIR/test1_py_hnsw.json"; then
    pass "Test 1: Python HNSW queries return correct top-1"
else
    fail "Test 1: Python HNSW queries - incorrect top-1 results"
fi
if grep -q '"num_results":' "$RESULTS_DIR/test1_py_fts.json" && ! grep -q '"error"' "$RESULTS_DIR/test1_py_fts.json"; then
    pass "Test 1: Python FTS queries execute successfully"
else
    fail "Test 1: Python FTS queries failed"
fi

# ── Test 2: Python creates everything, Rust reads (THE CRITICAL TEST) ───────

log ""
log "═══════════════════════════════════════════════════════════════"
log "  Test 2: Python creates everything → Rust reads"
log "  ★ THIS IS THE CRITICAL CROSS-LANGUAGE TEST ★"
log "═══════════════════════════════════════════════════════════════"

DB2="/tmp/compat_test2.duckdb"
# Fresh db, Python does everything
py "$SCRIPT_DIR/python_side.py" create-schema "$DB2" >/dev/null
py "$SCRIPT_DIR/python_side.py" write-data "$DB2" >/dev/null
py "$SCRIPT_DIR/python_side.py" create-hnsw "$DB2" >/dev/null
py "$SCRIPT_DIR/python_side.py" create-fts "$DB2" >/dev/null

# Copy query vectors next to db for Rust to find

# Rust reads
$RUST_BIN query-hnsw "$DB2" > "$RESULTS_DIR/test2_rs_hnsw.json" 2>&1 || true
$RUST_BIN query-fts "$DB2" > "$RESULTS_DIR/test2_rs_fts.json" 2>&1 || true
$RUST_BIN check-indexes "$DB2" > "$RESULTS_DIR/test2_rs_indexes.json" 2>&1 || true

# Validate
if [ -s "$RESULTS_DIR/test2_rs_hnsw.json" ] && grep -q '"results"' "$RESULTS_DIR/test2_rs_hnsw.json"; then
    pass "Test 2: Rust can read Python-created HNSW index (no crash)"
    # Check if results match
    if grep -q '"top1_match": true' "$RESULTS_DIR/test2_rs_hnsw.json"; then
        pass "Test 2: Rust HNSW queries return correct top-1 on Python-created index"
    else
        fail "Test 2: Rust HNSW queries return incorrect results on Python-created index"
    fi
else
    fail "Test 2: Rust CRASHED reading Python-created HNSW index"
fi

if [ -s "$RESULTS_DIR/test2_rs_fts.json" ] && grep -q '"results"' "$RESULTS_DIR/test2_rs_fts.json"; then
    pass "Test 2: Rust can read Python-created FTS index (no crash)"
    if ! grep -q '"error"' "$RESULTS_DIR/test2_rs_fts.json"; then
        pass "Test 2: Rust FTS queries execute without errors on Python-created index"
    else
        fail "Test 2: Rust FTS queries had errors on Python-created index"
    fi
else
    fail "Test 2: Rust CRASHED reading Python-created FTS index"
fi

# ── Test 3: Python data, Rust indexes, Python reads ─────────────────────────

log ""
log "═══════════════════════════════════════════════════════════════"
log "  Test 3: Python data → Rust indexes → Python reads"
log "═══════════════════════════════════════════════════════════════"

DB3="/tmp/compat_test3.duckdb"
py "$SCRIPT_DIR/python_side.py" create-schema "$DB3" >/dev/null
py "$SCRIPT_DIR/python_side.py" write-data "$DB3" >/dev/null
$RUST_BIN create-hnsw "$DB3" >/dev/null 2>&1
$RUST_BIN create-fts "$DB3" >/dev/null 2>&1
py "$SCRIPT_DIR/python_side.py" query-hnsw "$DB3" > "$RESULTS_DIR/test3_py_hnsw.json"
py "$SCRIPT_DIR/python_side.py" query-fts "$DB3" > "$RESULTS_DIR/test3_py_fts.json"

if grep -q '"top1_match": true' "$RESULTS_DIR/test3_py_hnsw.json"; then
    pass "Test 3: Python can query Rust-created HNSW index with correct results"
else
    fail "Test 3: Python HNSW queries fail on Rust-created index"
fi
if grep -q '"num_results":' "$RESULTS_DIR/test3_py_fts.json" && ! grep -q '"error"' "$RESULTS_DIR/test3_py_fts.json"; then
    pass "Test 3: Python can query Rust-created FTS index"
else
    fail "Test 3: Python FTS queries fail on Rust-created index"
fi

# ── Test 4: Python data, Rust indexes, Rust reads ───────────────────────────

log ""
log "═══════════════════════════════════════════════════════════════"
log "  Test 4: Python data → Rust indexes → Rust reads"
log "═══════════════════════════════════════════════════════════════"

DB4="/tmp/compat_test4.duckdb"
py "$SCRIPT_DIR/python_side.py" create-schema "$DB4" >/dev/null
py "$SCRIPT_DIR/python_side.py" write-data "$DB4" >/dev/null
$RUST_BIN create-hnsw "$DB4" >/dev/null 2>&1
$RUST_BIN create-fts "$DB4" >/dev/null 2>&1
$RUST_BIN query-hnsw "$DB4" > "$RESULTS_DIR/test4_rs_hnsw.json" 2>&1 || true
$RUST_BIN query-fts "$DB4" > "$RESULTS_DIR/test4_rs_fts.json" 2>&1 || true

if grep -q '"top1_match": true' "$RESULTS_DIR/test4_rs_hnsw.json"; then
    pass "Test 4: Rust HNSW queries correct on Python-data + Rust-created index"
else
    fail "Test 4: Rust HNSW queries incorrect on Python-data + Rust-created index"
fi
if [ -s "$RESULTS_DIR/test4_rs_fts.json" ] && ! grep -q '"error"' "$RESULTS_DIR/test4_rs_fts.json"; then
    pass "Test 4: Rust FTS queries work on Python-data + Rust-created index"
else
    fail "Test 4: Rust FTS queries fail on Python-data + Rust-created index"
fi

# ── Test 5: Rust schema, Python data + indexes, Rust reads ──────────────────

log ""
log "═══════════════════════════════════════════════════════════════"
log "  Test 5: Rust schema → Python data + indexes → Rust reads"
log "═══════════════════════════════════════════════════════════════"

DB5="/tmp/compat_test5.duckdb"
$RUST_BIN create-schema "$DB5" >/dev/null 2>&1
py "$SCRIPT_DIR/python_side.py" write-data "$DB5" >/dev/null
py "$SCRIPT_DIR/python_side.py" create-hnsw "$DB5" >/dev/null
py "$SCRIPT_DIR/python_side.py" create-fts "$DB5" >/dev/null
$RUST_BIN query-hnsw "$DB5" > "$RESULTS_DIR/test5_rs_hnsw.json" 2>&1 || true
$RUST_BIN query-fts "$DB5" > "$RESULTS_DIR/test5_rs_fts.json" 2>&1 || true

if [ -s "$RESULTS_DIR/test5_rs_hnsw.json" ] && grep -q '"results"' "$RESULTS_DIR/test5_rs_hnsw.json"; then
    pass "Test 5: Rust reads Python-created HNSW on Rust-created schema (no crash)"
    if grep -q '"top1_match": true' "$RESULTS_DIR/test5_rs_hnsw.json"; then
        pass "Test 5: Correct HNSW results"
    else
        fail "Test 5: Incorrect HNSW results"
    fi
else
    fail "Test 5: Rust CRASHED on Rust-schema + Python-indexed DB"
fi
if [ -s "$RESULTS_DIR/test5_rs_fts.json" ] && ! grep -q '"error"' "$RESULTS_DIR/test5_rs_fts.json"; then
    pass "Test 5: Rust FTS works on Rust-schema + Python-indexed DB"
else
    fail "Test 5: Rust FTS fails on Rust-schema + Python-indexed DB"
fi

# ── Test 6: Rust creates everything, Rust reads ─────────────────────────────

log ""
log "═══════════════════════════════════════════════════════════════"
log "  Test 6: Rust → Rust (baseline)"
log "═══════════════════════════════════════════════════════════════"

DB6="/tmp/compat_test6.duckdb"
$RUST_BIN create-schema "$DB6" >/dev/null 2>&1
$RUST_BIN write-data "$DB6" >/dev/null 2>&1
$RUST_BIN create-hnsw "$DB6" >/dev/null 2>&1
$RUST_BIN create-fts "$DB6" >/dev/null 2>&1
$RUST_BIN query-hnsw "$DB6" > "$RESULTS_DIR/test6_rs_hnsw.json" 2>&1 || true
$RUST_BIN query-fts "$DB6" > "$RESULTS_DIR/test6_rs_fts.json" 2>&1 || true

# Note: Rust uses its own RNG so top-1 matches are not expected against Python query vectors.
# We just verify no crashes and results are returned.
if [ -s "$RESULTS_DIR/test6_rs_hnsw.json" ] && grep -q '"results"' "$RESULTS_DIR/test6_rs_hnsw.json"; then
    pass "Test 6: Rust-only HNSW baseline works"
else
    fail "Test 6: Rust-only HNSW baseline failed"
fi
if [ -s "$RESULTS_DIR/test6_rs_fts.json" ] && ! grep -q '"error"' "$RESULTS_DIR/test6_rs_fts.json"; then
    pass "Test 6: Rust-only FTS baseline works"
else
    fail "Test 6: Rust-only FTS baseline failed"
fi

# ── Test 7: Persistence test (Python creates, close, Rust opens fresh) ──────

log ""
log "═══════════════════════════════════════════════════════════════"
log "  Test 7: Persistence — Python creates, close DB, Rust opens fresh"
log "═══════════════════════════════════════════════════════════════"

DB7="/tmp/compat_test7.duckdb"
py "$SCRIPT_DIR/python_side.py" create-schema "$DB7" >/dev/null
py "$SCRIPT_DIR/python_side.py" write-data "$DB7" >/dev/null
py "$SCRIPT_DIR/python_side.py" create-hnsw "$DB7" >/dev/null
py "$SCRIPT_DIR/python_side.py" create-fts "$DB7" >/dev/null

# Explicitly verify the DB file exists and WAL is flushed
sync
sleep 1

$RUST_BIN check-indexes "$DB7" > "$RESULTS_DIR/test7_rs_indexes.json" 2>&1 || true
$RUST_BIN query-hnsw "$DB7" > "$RESULTS_DIR/test7_rs_hnsw.json" 2>&1 || true
$RUST_BIN query-fts "$DB7" > "$RESULTS_DIR/test7_rs_fts.json" 2>&1 || true

if grep -q '"fts_exists": true' "$RESULTS_DIR/test7_rs_indexes.json"; then
    pass "Test 7: FTS internal table visible in information_schema after reopen"
else
    # FTS internal tables may not appear in information_schema across connections,
    # but the index can still be functional. Check actual query results instead.
    if [ -s "$RESULTS_DIR/test7_rs_fts.json" ] && grep -q '"num_results":' "$RESULTS_DIR/test7_rs_fts.json" && ! grep -q '"error"' "$RESULTS_DIR/test7_rs_fts.json"; then
        pass "Test 7: FTS internal table not in information_schema, but FTS queries WORK (detection issue only)"
    else
        fail "Test 7: FTS index NOT functional after Python creation + close"
    fi
fi

if grep -q 'idx_chunks_hnsw' "$RESULTS_DIR/test7_rs_indexes.json"; then
    pass "Test 7: HNSW index persists across Python→Rust connection"
else
    fail "Test 7: HNSW index NOT found after Python creation + close"
fi

if [ -s "$RESULTS_DIR/test7_rs_hnsw.json" ] && grep -q '"top1_match": true' "$RESULTS_DIR/test7_rs_hnsw.json"; then
    pass "Test 7: Persisted HNSW index returns correct results from Rust"
else
    fail "Test 7: Persisted HNSW index returns incorrect results from Rust"
fi

# ── Summary ─────────────────────────────────────────────────────────────────

log ""
log "═══════════════════════════════════════════════════════════════"
log "  RESULTS SUMMARY"
log "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "  ${GREEN}Passed: $passed${NC}"
echo -e "  ${RED}Failed: $failed${NC}"
echo ""

if [ $failed -gt 0 ]; then
    echo -e "${RED}Failed tests:${NC}"
    for err in "${errors[@]}"; do
        echo -e "  ${RED}✗${NC} $err"
    done
    echo ""
    echo -e "${YELLOW}Conclusion: Cross-language index incompatibility CONFIRMED.${NC}"
    echo "  Current design (Rust-only HNSW creation) is justified."
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    echo ""
    echo -e "${GREEN}Conclusion: DuckDB indexes are FULLY COMPATIBLE across Python/Rust.${NC}"
    echo "  The Rust-only HNSW constraint can be removed."
    echo "  Both sides can freely create and query HNSW/FTS indexes."
    exit 0
fi
