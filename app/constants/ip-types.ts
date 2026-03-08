export const IP_TYPES: Record<string, 'creation.ip' | 'moltbook.ip'> = {
  'picoclaw.gno': 'creation.ip',
  'agent.gno':    'creation.ip',
  'nftmail.gno':  'creation.ip',   // NFTmail.gno brand — stored/matched as lowercase
  'openclaw.gno': 'creation.ip',
  'molt.gno':     'moltbook.ip',
  'vault.gno':    'creation.ip',
};

export function getIPType(domain: string): string {
  return IP_TYPES[domain] || 'creation.ip';
}

// NO needsIPMigration function - .ip transfers automatically with Safe
