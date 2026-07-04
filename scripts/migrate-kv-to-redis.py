#!/usr/bin/env python3
"""
Migrate Cloudflare KV (INBOX_KV) to Hetzner Redis.

Phase 1 (local): export all keys+values from CF KV via wrangler --remote
                 into a JSONL dump (preserving TTLs from the key list).
Phase 2 (server): scp dump to Hetzner, load into Redis with SET + EXPIREAT.

Usage:
  python3 scripts/migrate-kv-to-redis.py export   # writes /tmp/kv-dump.jsonl
  python3 scripts/migrate-kv-to-redis.py import   # scp + load into Redis
"""

import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

NAMESPACE_ID = "d2177071c3fb4c48a1a22b36ee1a1baf"
KEYS_FILE    = "/tmp/kv-keys.json"
DUMP_FILE    = "/tmp/kv-dump.jsonl"
WORKER_DIR   = Path(__file__).resolve().parent.parent / "workers" / "nftmail-email-worker"
HETZNER      = "root@46.225.158.75"
CONCURRENCY  = 8


def fetch_key(name):
    """Fetch a single KV value via wrangler. Returns raw string or None."""
    for attempt in range(3):
        try:
            r = subprocess.run(
                ["npx", "wrangler", "kv", "key", "get", name,
                 f"--namespace-id={NAMESPACE_ID}", "--remote"],
                capture_output=True, text=True, timeout=30, cwd=WORKER_DIR,
            )
            if r.returncode == 0:
                return r.stdout
            time.sleep(1 + attempt)
        except subprocess.TimeoutExpired:
            time.sleep(1 + attempt)
    return None


def export():
    keys = json.load(open(KEYS_FILE))
    print(f"Exporting {len(keys)} keys with concurrency {CONCURRENCY}…")

    done = 0
    failed = []
    with open(DUMP_FILE, "w") as out:
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            futures = {pool.submit(fetch_key, k["name"]): k for k in keys}
            for fut in as_completed(futures):
                k = futures[fut]
                val = fut.result()
                done += 1
                if val is None:
                    failed.append(k["name"])
                    print(f"  FAILED: {k['name']}")
                    continue
                rec = {"key": k["name"], "value": val}
                if "expiration" in k:
                    rec["expiration"] = k["expiration"]
                out.write(json.dumps(rec) + "\n")
                if done % 50 == 0:
                    print(f"  {done}/{len(keys)}")

    print(f"Done. {done - len(failed)} exported, {len(failed)} failed → {DUMP_FILE}")
    if failed:
        print("Failed keys:", failed)


def import_to_redis():
    # Loader runs on the server: reads JSONL, writes RESP protocol for redis-cli --pipe.
    # RESP format: *3\r\n$3\r\nSET\r\n$<keylen>\r\n<key>\r\n$<vallen>\r\n<value>\r\n
    loader = r'''
import base64, json, time

def resp_bulk(s):
    return f"${len(s)}\r\n{s}\r\n"

def resp_array(count):
    return f"*{count}\r\n"

def resp_simple(s):
    return f"+{s}\r\n"

now = int(time.time())
ok = skipped = 0
with open("/tmp/kv-dump.jsonl") as f, open("/tmp/redis-commands.txt", "wb") as out:
    for line in f:
        rec = json.loads(line)
        key, val = rec["key"], rec["value"]
        exp = rec.get("expiration")
        if exp and exp <= now:
            skipped += 1
            continue
        b64 = base64.b64encode(val.encode()).decode()
        if exp:
            ttl = exp - now
            # SETEX key ttl value
            out.write(resp_array(4).encode())
            out.write(resp_bulk("SETEX").encode())
            out.write(resp_bulk(key).encode())
            out.write(resp_bulk(str(ttl)).encode())
            out.write(resp_bulk(b64).encode())
        else:
            # SET key value
            out.write(resp_array(3).encode())
            out.write(resp_bulk("SET").encode())
            out.write(resp_bulk(key).encode())
            out.write(resp_bulk(b64).encode())
        ok += 1
print(f"loaded={ok} skipped-expired={skipped}")
'''
    print("Copying dump to Hetzner…")
    subprocess.run(["scp", DUMP_FILE, f"{HETZNER}:/tmp/kv-dump.jsonl"], check=True)
    Path("/tmp/redis-loader.py").write_text(loader)
    subprocess.run(["scp", "/tmp/redis-loader.py", f"{HETZNER}:/tmp/redis-loader.py"], check=True)
    print("Generating Redis commands on server…")
    subprocess.run(["ssh", HETZNER, "python3 /tmp/redis-loader.py"], check=True)
    print("Loading into Redis (piped to redis-cli)…")
    subprocess.run(["ssh", HETZNER, "cat /tmp/redis-commands.txt | redis-cli -a uVqkvi8WKcQZ8m6X2iUdpkjwGsmD --no-auth-warning --pipe"], check=True)
    print("Verify:")
    subprocess.run(["ssh", HETZNER,
                    'redis-cli -a uVqkvi8WKcQZ8m6X2iUdpkjwGsmD --no-auth-warning DBSIZE'], check=True)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "export":
        export()
    elif cmd == "import":
        import_to_redis()
    else:
        print(__doc__)
        sys.exit(1)
