import { MetadataRegistry } from "generated";

MetadataRegistry.MetadataSet.handler(async ({ event, context }) => {
  const { tokenId, key, value } = event.params;
  const id = `${tokenId.toString()}:${key}`;

  context.Metadata.set({
    id,
    tokenId,
    key,
    value,
    setAt: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  });
});
