import { indexer } from "envio";

const OPENCLAW_ADDRESS = "0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe";

indexer.onEvent({ contract: "OpenClawRegistrar", event: "SubnameMinted" }, async ({ event, context }) => {
  const { parentNode, labelhash, subnode, tokenId, owner } = event.params;

  context.SubnameMint.set({
    id: `openclaw:${tokenId.toString()}`,
    registrar: "openclaw",
    registrarAddress: OPENCLAW_ADDRESS,
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

indexer.onEvent({ contract: "OpenClawRegistrar", event: "TokenboundAccountCreated" }, async ({ event, context }) => {
  const { account, tokenId } = event.params;
  const existing = await context.SubnameMint.get(`openclaw:${tokenId.toString()}`);
  if (existing) {
    context.SubnameMint.set({ ...existing, tba: account.toLowerCase() });
  }
});
