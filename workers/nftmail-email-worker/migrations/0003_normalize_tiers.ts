/**
 * Migration 0003: Normalize tier names in KV
 * lite/professional/pupa → pro
 * basic → free
 * vault/imago/ghost → premium
 */

export async function migrate(kv: KVNamespace): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;
  let cursor: string | undefined = undefined;

  do {
    const result = await kv.list({ prefix: 'acct-tier:', cursor, limit: 100 });
    for (const key of result.keys) {
      try {
        const raw = await kv.get(key.name);
        if (!raw) continue;
        const record = JSON.parse(raw) as { tier: string };
        const oldTier = record.tier.toLowerCase();
        let newTier = oldTier;
        if (['lite', 'professional', 'pupa'].includes(oldTier)) newTier = 'pro';
        else if (oldTier === 'basic') newTier = 'free';
        else if (['vault', 'imago', 'ghost'].includes(oldTier)) newTier = 'premium';
        
        if (oldTier !== newTier) {
          record.tier = newTier;
          await kv.put(key.name, JSON.stringify(record));
          updated++;
        }
      } catch (e) {
        errors.push(`${key.name}: ${e}`);
      }
    }
    cursor = result.cursor;
  } while (cursor);

  return { updated, errors };
}
