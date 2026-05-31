import { OpenClawRegistrar } from "generated";

OpenClawRegistrar.SubnameMinted.handler(async ({ event, context }) => {
  const { parentNode, labelhash, subnode, tokenId, owner } = event.params;
  const id = `0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe:${tokenId.toString()}`;

  const existing = await context.SubnameMint.get(id);
  context.SubnameMint.set({
    id,
    registrar: "openclaw",
    registrarAddress: "0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe",
    parentNode,
    labelhash,
    subnode,
    tokenId,
    owner: owner.toLowerCase(),
    tba: existing?.tba ?? null,
    mintedAt: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  });
});

OpenClawRegistrar.TokenboundAccountCreated.handler(async ({ event, context }) => {
  const { account, tokenId } = event.params;
  const id = `0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe:${tokenId.toString()}`;
  const existing = await context.SubnameMint.get(id);
  if (existing) {
    context.SubnameMint.set({ ...existing, tba: account.toLowerCase() });
  }
});
