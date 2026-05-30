import {
  IdentityRegistry,
  GhostRegistry,
  MoltRegistrar,
  OpenClawRegistrar,
  PicoClawRegistrar,
} from "generated";

// ── IdentityRegistry: AgentRegistered ────────────────────────────────────────

IdentityRegistry.AgentRegistered.handler(async ({ event, context }) => {
  const { agentId, owner, agentURI } = event.params;
  const chainId = event.chainId;

  const reg = {
    id: `${chainId}:${agentId.toString()}`,
    agentId,
    owner: owner.toLowerCase(),
    agentURI,
    registeredAt: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  };
  context.Erc8004Registration.set(reg);

  // Upsert SafeIndex — we don't have the Safe here, but we can update later
  // when GhostRegistry.Registered fires with same agentId context.
});

// ── GhostRegistry: Registered ────────────────────────────────────────────────

GhostRegistry.Registered.handler(async ({ event, context }) => {
  const { tokenId, name, owner, tba, safe } = event.params;

  const agent = {
    id: tokenId.toString(),
    tokenId,
    name,
    owner: owner.toLowerCase(),
    tba: tba.toLowerCase(),
    safe: safe.toLowerCase(),
    principal: owner.toLowerCase(),
    registeredAt: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  };
  context.GhostAgent.set(agent);

  // Index the Safe address for fast reverse lookup
  const safeId = safe.toLowerCase();
  const existing = await context.SafeIndex.get(safeId);
  context.SafeIndex.set({
    id: safeId,
    safeAddress: safeId,
    sources: existing ? `${existing.sources},ghostregistry` : "ghostregistry",
    agentName: name,
    erc8004AgentId: existing?.erc8004AgentId ?? null,
    lastUpdated: BigInt(event.block.timestamp),
  });
});

// ── GhostRegistry: Molted ────────────────────────────────────────────────────

GhostRegistry.Molted.handler(async ({ event, context }) => {
  const { tokenId, oldTba, newTba, safe } = event.params;

  const molt = {
    id: `${tokenId.toString()}:${event.block.number}`,
    agent_id: tokenId.toString(),
    oldTba: oldTba.toLowerCase(),
    newTba: newTba.toLowerCase(),
    safe: safe.toLowerCase(),
    moltedAt: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  };
  context.Molt.set(molt);

  // Update agent TBA
  const existing = await context.GhostAgent.get(tokenId.toString());
  if (existing) {
    context.GhostAgent.set({ ...existing, tba: newTba.toLowerCase() });
  }
});

// ── GhostRegistry: PrincipalSet ──────────────────────────────────────────────

GhostRegistry.PrincipalSet.handler(async ({ event, context }) => {
  const { agentId, principal } = event.params;
  const existing = await context.GhostAgent.get(agentId.toString());
  if (existing) {
    context.GhostAgent.set({ ...existing, principal: principal.toLowerCase() });
  }
});

// ── GhostRegistry: ByoGovernorSet ────────────────────────────────────────────

GhostRegistry.ByoGovernorSet.handler(async ({ event, context }) => {
  const { byoContract, byoTokenId, safe, governor } = event.params;

  const byo = {
    id: `${byoContract.toLowerCase()}:${byoTokenId.toString()}`,
    byoContract: byoContract.toLowerCase(),
    byoTokenId,
    safe: safe.toLowerCase(),
    governor: governor.toLowerCase(),
    registeredAt: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  };
  context.ByoAgent.set(byo);

  // Index the Safe
  const safeId = safe.toLowerCase();
  const existing = await context.SafeIndex.get(safeId);
  context.SafeIndex.set({
    id: safeId,
    safeAddress: safeId,
    sources: existing ? `${existing.sources},byo` : "byo",
    agentName: existing?.agentName ?? null,
    erc8004AgentId: existing?.erc8004AgentId ?? null,
    lastUpdated: BigInt(event.block.timestamp),
  });
});

// ── BaseRegistrar: SubnameMinted (shared handler for all three registrars) ───

function subnameMintedHandler(registrar: string, registrarAddress: string) {
  return async ({ event, context }: { event: any; context: any }) => {
    const { parentNode, labelhash, subnode, tokenId, owner } = event.params;
    const id = `${registrarAddress}:${tokenId.toString()}`;

    const existing = await context.SubnameMint.get(id);
    context.SubnameMint.set({
      id,
      registrar,
      registrarAddress: registrarAddress.toLowerCase(),
      parentNode: parentNode,
      labelhash: labelhash,
      subnode: subnode,
      tokenId,
      owner: owner.toLowerCase(),
      tba: existing?.tba ?? null,
      mintedAt: BigInt(event.block.timestamp),
      blockNumber: BigInt(event.block.number),
      txHash: event.transaction.hash,
    });
  };
}

MoltRegistrar.SubnameMinted.handler(
  subnameMintedHandler("molt", "0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50")
);
OpenClawRegistrar.SubnameMinted.handler(
  subnameMintedHandler("openclaw", "0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe")
);
PicoClawRegistrar.SubnameMinted.handler(
  subnameMintedHandler("picoclaw", "0xe5fd65562698f46ea9762bd38141535b1fd875b5")
);

// ── BaseRegistrar: TokenboundAccountCreated ───────────────────────────────────
// Patch the tba onto the SubnameMint that was just set in the same block

function tbacreatedHandler(registrarAddress: string) {
  return async ({ event, context }: { event: any; context: any }) => {
    const { account, tokenId } = event.params;
    const id = `${registrarAddress}:${tokenId.toString()}`;
    const existing = await context.SubnameMint.get(id);
    if (existing) {
      context.SubnameMint.set({ ...existing, tba: account.toLowerCase() });
    }
  };
}

MoltRegistrar.TokenboundAccountCreated.handler(
  tbacreatedHandler("0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50")
);
OpenClawRegistrar.TokenboundAccountCreated.handler(
  tbacreatedHandler("0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe")
);
PicoClawRegistrar.TokenboundAccountCreated.handler(
  tbacreatedHandler("0xe5fd65562698f46ea9762bd38141535b1fd875b5")
);
