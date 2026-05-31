import { GhostRegistry } from "generated";

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

  const existing = await context.GhostAgent.get(tokenId.toString());
  if (existing) {
    context.GhostAgent.set({ ...existing, tba: newTba.toLowerCase() });
  }
});

GhostRegistry.PrincipalSet.handler(async ({ event, context }) => {
  const { agentId, principal } = event.params;
  const existing = await context.GhostAgent.get(agentId.toString());
  if (existing) {
    context.GhostAgent.set({ ...existing, principal: principal.toLowerCase() });
  }
});

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
