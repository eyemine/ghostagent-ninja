import { indexer } from "envio";

const MOLT_ADDRESS = "0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50";

indexer.onEvent({ contract: "MoltRegistrar", event: "SubnameMinted" }, async ({ event, context }) => {
  const { parentNode, labelhash, subnode, tokenId, owner } = event.params;

  context.SubnameMint.set({
    id: `molt:${tokenId.toString()}`,
    registrar: "molt",
    registrarAddress: MOLT_ADDRESS,
    parentNode,
    labelhash,
    subnode,
    tokenId,
    owner: owner.toLowerCase(),
    tba: undefined,
    mintedAt: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  });
});

indexer.onEvent({ contract: "MoltRegistrar", event: "TokenboundAccountCreated" }, async ({ event, context }) => {
  const { account, tokenId } = event.params;
  const existing = await context.SubnameMint.get(`molt:${tokenId.toString()}`);
  if (existing) {
    context.SubnameMint.set({ ...existing, tba: account.toLowerCase() });
  }
});
