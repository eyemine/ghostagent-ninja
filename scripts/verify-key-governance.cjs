// Execute ONLY against a local Anvil fork. No mainnet signing keys are loaded.
// Usage: anvil --fork-url https://rpc.gnosischain.com --port 8547
//        node scripts/verify-key-governance.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (mod, file) => {
  if (!file.startsWith(root + path.sep)) throw new Error('Unexpected TS import');
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
};
const {
  createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData,
  decodeFunctionResult, hashMessage, toHex, zeroAddress,
} = require('viem');
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
const { gnosis } = require('viem/chains');
const rpc = process.env.KEY_TEST_RPC || 'http://127.0.0.1:8547';
if (!['localhost', '127.0.0.1'].includes(new URL(rpc).hostname)) throw new Error('Local fork required');
process.env.GNOSIS_RPC_URL = rpc;
const { deployGnosisTba, computeGnosisTba } = require('../app/services/gnosis-tba.ts');
const { createSafeForByoMolt } = require('../app/services/create-safe.ts');
const { verifySafeKeyExecution, safeCallFromTba, SAFE_KEY_ABI, TBA_EXECUTE_ABI } = require('../app/services/safe-key.ts');
const { KEY_REGISTRARS, KEY_REGISTRAR_ABI, findRecentKeyMint } = require('../app/services/gnosis-key.ts');

async function main() {
  const client = createPublicClient({ chain: gnosis, transport: http(rpc) });
  const version = await client.request({ method: 'web3_clientVersion' });
  assert.match(version.toLowerCase(), /anvil/);
  const ownerKey = generatePrivateKey();
  const owner = privateKeyToAccount(ownerKey);
  const buyer = privateKeyToAccount(generatePrivateKey());
  const wallet = createWalletClient({ chain: gnosis, transport: http(rpc), account: owner });
  const buyerWallet = createWalletClient({ chain: gnosis, transport: http(rpc), account: buyer });
  for (const account of [owner, buyer]) {
    await client.request({ method: 'anvil_setBalance', params: [account.address, toHex(10n ** 20n)] });
  }
  const registrar = KEY_REGISTRARS['vault.gno'];
  const registrarOwner = await client.readContract({
    address: registrar, abi: parseAbi(['function owner() view returns(address)']), functionName: 'owner',
  });
  await client.request({ method: 'anvil_impersonateAccount', params: [registrarOwner] });
  const minter = createWalletClient({ chain: gnosis, transport: http(rpc), account: registrarOwner });
  const label = `key-proof-${Date.now()}`;
  const mint = await client.simulateContract({
    address: registrar, abi: KEY_REGISTRAR_ABI, functionName: 'mintSubname',
    args: [label, owner.address, '0x', toHex(0n, { size: 32 })], account: registrarOwner,
  });
  const mintHash = await minter.writeContract(mint.request);
  assert.equal((await client.waitForTransactionReceipt({ hash: mintHash })).status, 'success');
  const tokenId = mint.result[0];
  const nft = { sourceChainId: 100, contractAddress: registrar, tokenId };
  await assert.rejects(() => computeGnosisTba({ ...nft, sourceChainId: 1 }), /Gnosis key NFT/);
  const key = await findRecentKeyMint(client, registrar, label, 'vault.gno', owner.address);
  assert.equal(key.tokenId, tokenId);
  await assert.rejects(() => findRecentKeyMint(client, registrar, label, 'vault.gno', buyer.address), /Recovery/);
  const tba = await deployGnosisTba(nft, wallet);
  assert.equal(tba.nftOwner.toLowerCase(), owner.address.toLowerCase());
  assert.equal((await deployGnosisTba(nft, wallet)).alreadyDeployed, true);
  const safeResult = await createSafeForByoMolt(`${label}.vault.gno`, tba.tbaAddress, ownerKey, owner.address);
  assert.ok(safeResult.safeAddress, safeResult.error);
  const safe = safeResult.safeAddress;
  const again = await createSafeForByoMolt(`${label}.vault.gno`, tba.tbaAddress, ownerKey, owner.address);
  assert.equal(again.safeAddress, safe);
  assert.equal(again.alreadyExisted, true);
  await verifySafeKeyExecution(client, safe, tba.tbaAddress, owner.address);

  const erc1271 = parseAbi(['function isValidSignature(bytes32 hash,bytes signature) view returns(bytes4)']);
  const message = 'Local fork proof: Gnosis key controls Safe';
  const signature = await owner.signMessage({ message });
  const badSignature = await buyer.signMessage({ message });
  const checkSignature = signature => client.readContract({
    address: tba.tbaAddress, abi: erc1271, functionName: 'isValidSignature',
    args: [hashMessage(message), signature],
  });
  assert.equal(await checkSignature(signature), '0x1626ba7e');
  assert.notEqual(await checkSignature(badSignature), '0x1626ba7e');

  const execute = async (signer, data) => {
    const call = { address: tba.tbaAddress, abi: TBA_EXECUTE_ABI, functionName: 'execute',
      args: [safe, 0n, data, 0], account: signer.account };
    const simulated = await client.simulateContract(call);
    assert.equal(decodeFunctionResult({ abi: SAFE_KEY_ABI, functionName: 'execTransaction', data: simulated.result }), true);
    const hash = await signer.writeContract(call);
    assert.equal((await client.waitForTransactionReceipt({ hash })).status, 'success');
    return hash;
  };
  const nonce = () => client.readContract({ address: safe, abi: SAFE_KEY_ABI, functionName: 'nonce' });
  const initialNonce = await nonce();
  const proofHash = await execute(wallet, safeCallFromTba(tba.tbaAddress, buyer.address));
  assert.equal(await nonce(), initialNonce + 1n);

  // Remove recovery only AFTER a real transaction executed through the TBA.
  const owners = await client.readContract({ address: safe, abi: SAFE_KEY_ABI, functionName: 'getOwners' });
  const index = owners.findIndex(a => a.toLowerCase() === owner.address.toLowerCase());
  assert.notEqual(index, -1);
  const prev = index === 0 ? '0x0000000000000000000000000000000000000001' : owners[index - 1];
  await execute(wallet, safeCallFromTba(tba.tbaAddress, safe, encodeFunctionData({
    abi: SAFE_KEY_ABI, functionName: 'removeOwner', args: [prev, owner.address, 1n],
  })));
  assert.deepEqual((await client.readContract({ address: safe, abi: SAFE_KEY_ABI, functionName: 'getOwners' })).map(x => x.toLowerCase()), [tba.tbaAddress.toLowerCase()]);

  const transfer = await wallet.writeContract({
    address: registrar, abi: parseAbi(['function transferFrom(address from,address to,uint256 id)']),
    functionName: 'transferFrom', args: [owner.address, buyer.address, tokenId],
  });
  assert.equal((await client.waitForTransactionReceipt({ hash: transfer })).status, 'success');
  assert.notEqual(await checkSignature(signature), '0x1626ba7e');
  assert.equal(await checkSignature(badSignature), '0x1626ba7e');
  await assert.rejects(() => verifySafeKeyExecution(client, safe, tba.tbaAddress, owner.address));
  await verifySafeKeyExecution(client, safe, tba.tbaAddress, buyer.address);
  await execute(buyerWallet, safeCallFromTba(tba.tbaAddress, owner.address));
  // Prevalidated signature bytes alone must not let an EOA bypass the TBA.
  await assert.rejects(() => client.call({
    to: safe, data: safeCallFromTba(tba.tbaAddress, buyer.address), account: owner.address,
  }));

  console.log(JSON.stringify({
    network: 'local-anvil-fork-only', registrar, tokenId: tokenId.toString(), tba: tba.tbaAddress, safe,
    assertions: [
      'cross-chain binding rejected', 'key mint retry checks actual NFT owner',
      'canonical initialization and binding verified', 'Safe deployment retry idempotent',
      'positive and negative ERC-1271 signatures', 'actual Safe execution via TBA',
      'recovery removed through TBA after execution', 'NFT transfer changes Safe authority',
      'previous holder rejected', 'EOA cannot forge TBA prevalidated signature',
    ], proofHash,
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
