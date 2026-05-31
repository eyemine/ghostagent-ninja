import { PicoClawRegistrar } from "generated";

PicoClawRegistrar.SubnameMinted.handler(async ({ event, context }) => {
  const { parentNode, labelhash, subnode, tokenId, owner } = event.params;
  const id = `0xe5fd65562698f46ea9762bd38141535b1fd875b5:${tokenId.toString()}`;

  const existing = await context.SubnameMint.get(id);
  context.SubnameMint.set({
    id,
    registrar: "picoclaw",
    registrarAddress: "0xe5fd65562698f46ea9762bd38141535b1fd875b5",
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

PicoClawRegistrar.TokenboundAccountCreated.handler(async ({ event, context }) => {
  const { account, tokenId } = event.params;
  const id = `0xe5fd65562698f46ea9762bd38141535b1fd875b5:${tokenId.toString()}`;
  const existing = await context.SubnameMint.get(id);
  if (existing) {
    context.SubnameMint.set({ ...existing, tba: account.toLowerCase() });
  }
});
