import { indexer } from "envio";

const PICOCLAW_ADDRESS = "0xe5fd65562698f46ea9762bd38141535b1fd875b5";

indexer.onEvent({ contract: "PicoClawRegistrar", event: "SubnameMinted" }, async ({ event, context }) => {
  const { parentNode, labelhash, subnode, tokenId, owner } = event.params;

  context.SubnameMint.set({
    id: `picoclaw:${tokenId.toString()}`,
    registrar: "picoclaw",
    registrarAddress: PICOCLAW_ADDRESS,
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

indexer.onEvent({ contract: "PicoClawRegistrar", event: "TokenboundAccountCreated" }, async ({ event, context }) => {
  const { account, tokenId } = event.params;
  const existing = await context.SubnameMint.get(`picoclaw:${tokenId.toString()}`);
  if (existing) {
    context.SubnameMint.set({ ...existing, tba: account.toLowerCase() });
  }
});
