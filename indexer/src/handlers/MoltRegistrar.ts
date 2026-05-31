import { MoltRegistrar } from "generated";

MoltRegistrar.SubnameMinted.handler(async ({ event, context }) => {
  const { parentNode, labelhash, subnode, tokenId, owner } = event.params;
  const id = `0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50:${tokenId.toString()}`;

  const existing = await context.SubnameMint.get(id);
  context.SubnameMint.set({
    id,
    registrar: "molt",
    registrarAddress: "0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50",
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

MoltRegistrar.TokenboundAccountCreated.handler(async ({ event, context }) => {
  const { account, tokenId } = event.params;
  const id = `0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50:${tokenId.toString()}`;
  const existing = await context.SubnameMint.get(id);
  if (existing) {
    context.SubnameMint.set({ ...existing, tba: account.toLowerCase() });
  }
});
