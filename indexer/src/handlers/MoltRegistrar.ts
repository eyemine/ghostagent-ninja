import { MoltRegistrar } from "generated";

MoltRegistrar.SubnameMinted.handler(async ({ event, context }) => {
  const { parentNode, labelhash, subnode, tokenId, owner } = event.params;

  const mint = {
    id: `${tokenId.toString()}:${event.block.number}`,
    parentNode,
    labelhash,
    subnode,
    tokenId,
    owner: owner.toLowerCase(),
    mintedAt: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  };
  context.SubnameMint.set(mint);
});

MoltRegistrar.TokenboundAccountCreated.handler(async ({ event, context }) => {
  const { account, tokenContract, tokenId } = event.params;

  const tba = {
    id: `${tokenId.toString()}:${event.block.number}`,
    account: account.toLowerCase(),
    tokenContract: tokenContract.toLowerCase(),
    tokenId,
    createdAt: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  };
  context.TokenboundAccount.set(tba);
});
