import { indexer } from "envio";

indexer.onEvent({ contract: "IdentityRegistry", event: "AgentRegistered" }, async ({ event, context }) => {
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
});
