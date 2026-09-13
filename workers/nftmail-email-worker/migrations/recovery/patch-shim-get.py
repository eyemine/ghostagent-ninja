#!/usr/bin/env python3
"""Patch the deployed bun-entry.ts RedisKVNamespaceShim.get() to reliably detect
base64 instead of the lenient decode that silently corrupts plain-JSON values.

Idempotent: exits cleanly if already patched. Writes a .bak alongside.
Usage: python3 patch-shim-get.py /opt/ghostagent/bun-worker/bun-entry.ts
"""
import sys, os

OLD = '''  async get(key: string): Promise<string | null> {
    const val = await this.redis.get(this.k(key));
    if (val === null) return null;
    // Decode base64 (migration script encoded values)
    try {
      return Buffer.from(val, 'base64').toString('utf-8');
    } catch {
      return val; // Not base64, return as-is
    }
  }'''

NEW = '''  async get(key: string): Promise<string | null> {
    const val = await this.redis.get(this.k(key));
    if (val === null) return null;
    // Values are plain JSON/text (written by this worker) OR base64 (seeded by
    // an old migration script). Only decode when the value looks like pure
    // base64, is NOT already JSON/text, and decodes to valid JSON. This avoids
    // the classic bug where a lenient base64 decode silently corrupts plain JSON.
    if (/^[A-Za-z0-9+/\\r\\n]+={0,2}$/.test(val) && !/^[\\[{"]/.test(val)) {
      try {
        const decoded = Buffer.from(val, 'base64').toString('utf-8');
        JSON.parse(decoded);
        return decoded;
      } catch { /* not base64-encoded JSON — fall through */ }
    }
    return val;
  }'''

def main():
    path = sys.argv[1]
    with open(path, 'r', encoding='utf-8') as f:
        src = f.read()
    if 'lenient base64 decode' in src or 'JSON.parse(decoded)' in src:
        print('already patched — no change')
        return
    if OLD not in src:
        print('ERROR: expected get() block not found; aborting (file may have drifted).')
        sys.exit(2)
    with open(path + '.bak', 'w', encoding='utf-8') as f:
        f.write(src)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(src.replace(OLD, NEW, 1))
    print('patched OK; backup at ' + path + '.bak')

if __name__ == '__main__':
    main()
