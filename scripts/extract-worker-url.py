#!/usr/bin/env python3
"""
Extract WORKER_URL to app/utils/config.ts

Removes every local `const WORKER_URL = process.env...` declaration
and adds `import { WORKER_URL } from '<rel>/utils/config';`
at the correct relative depth for each file.

Depth map (path segments from repo root, 0-indexed):
  app/services/*.ts           → depth 2 → ../utils/config
  app/api/**/route.ts         → depth 3 → ../../utils/config
  app/api/*/**/route.ts       → depth 4 → ../../../utils/config
  app/api/*/*/**/route.ts     → depth 5 → ../../../../utils/config
  app/.well-known/**/route.ts → depth 3 → ../../utils/config
"""

import re, glob

CONST_RE = re.compile(
    r'[ \t]*const WORKER_URL\s*=\s*'
    r'process\.env\.NFTMAIL_WORKER_URL\s*(?:\?\?|\|\|)\s*'
    r"['\"]https://nftmail-email-worker\.richard-159\.workers\.dev['\"]"
    r'\s*;\n?'
)

IMPORT_MARKER = 'WORKER_URL } from'

files = glob.glob('app/**/*.ts', recursive=True) + glob.glob('app/**/*.tsx', recursive=True)
changed = []

for fpath in sorted(files):
    if fpath == 'app/utils/config.ts':
        continue
    with open(fpath) as f:
        content = f.read()
    if not CONST_RE.search(content):
        continue

    # Remove the local declaration
    new_content = CONST_RE.sub('', content)

    # Compute relative path to utils/config
    depth = fpath.count('/')   # number of slashes = depth of file from repo root
    # depth 2 = app/services/file.ts    → 1 ../ back to app/ → ../utils/config
    # depth 3 = app/api/x/route.ts      → 2 ../  → ../../utils/config
    # depth 4 = app/api/x/y/route.ts    → 3 ../  → ../../../utils/config
    # depth 5 = app/api/x/y/z/route.ts  → 4 ../  → ../../../../utils/config
    backs = '../' * (depth - 1)
    rel   = f'{backs}utils/config'
    imp   = f"import {{ WORKER_URL }} from '{rel}';"

    # Only add if not already imported
    if IMPORT_MARKER not in new_content:
        lines = new_content.split('\n')
        # Insert after the last `import` line
        last_import = -1
        for i, line in enumerate(lines):
            if line.strip().startswith('import '):
                last_import = i
        if last_import >= 0:
            lines.insert(last_import + 1, imp)
        else:
            lines.insert(0, imp)
        new_content = '\n'.join(lines)

    with open(fpath, 'w') as f:
        f.write(new_content)
    changed.append(fpath)

print(f'Modified {len(changed)} files:')
for f in changed:
    print(' ', f)
