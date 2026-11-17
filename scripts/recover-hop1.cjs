// hopr1 recovery: mint hopr1.vault.gno -> canonical TBA -> Safe[TBA,recovery]
const fs=require('fs'),path=require('path');
for(const f of ['.env','.env.local']) { const p=path.resolve('/Users/richieogorman/CascadeProjects/ghostagent_ninja',f);
  if(fs.existsSync(p)) for(const line of fs.readFileSync(p,'utf8').split('\n')) {
    const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); } }
const ts=require('typescript');
const root='/Users/richieogorman/CascadeProjects/ghostagent_ninja';
require.extensions['.ts']=(mod,file)=>{ if(!file.startsWith(root+path.sep)) throw new Error('bad import '+file);
  mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file); };
const {createPublicClient,createWalletClient,http,parseAbi,parseAbiItem,decodeEventLog,namehash,toHex} = require('viem');
const {privateKeyToAccount}=require('viem/accounts');
const {gnosis}=require('viem/chains');
const {deployGnosisTba}=require(root+'/app/services/gnosis-tba.ts');
const {createSafeForByoMolt}=require(root+'/app/services/create-safe.ts');
const {verifySafeKeyExecution}=require(root+'/app/services/safe-key.ts');
const {KEY_REGISTRARS,KEY_REGISTRAR_ABI,findRecentKeyMint}=require(root+'/app/services/gnosis-key.ts');

const OWNER='0xf251Ca37a80200f7AfefF398DA0338f4C1f01249';
const LABEL='hopr1', TLD='vault.gno';
const REGISTRAR=KEY_REGISTRARS[TLD];
const MINT_EVENT=parseAbiItem('event SubnameMinted(bytes32 indexed parentNode,bytes32 indexed labelhash,bytes32 indexed subnode,uint256 tokenId,address owner)');

(async()=>{
  const key=process.env.TREASURY_PRIVATE_KEY;
  if(!key) throw new Error('no TREASURY_PRIVATE_KEY');
  const rpc=process.env.GNOSIS_RPC_URL||'https://rpc.gnosischain.com';
  const account=privateKeyToAccount(key);
  const client=createPublicClient({chain:gnosis,transport:http(rpc)});
  const wallet=createWalletClient({chain:gnosis,transport:http(rpc),account});
  console.log('treasury',account.address,'registrar',REGISTRAR);

  console.log('step0 idempotency');
  // Step 0
  let tokenId=null;
  const existing=await findRecentKeyMint(client,REGISTRAR,LABEL,TLD,OWNER).catch(e=>{ if(/Recovery|receipt/.test(e.message)) return null; throw e; });
  if(existing){ tokenId=existing.tokenId; console.log('reusing mint',tokenId.toString(),existing.txHash); }
  else {
    console.log('step1 mintSubname sim+tx');
    // Step 1: mint hopr1.vault.gno to OWNER
    const sim=await client.simulateContract({address:REGISTRAR,abi:KEY_REGISTRAR_ABI,functionName:'mintSubname',
      args:[LABEL,OWNER,'0x','0x0000000000000000000000000000000000000000000000000000000000000000'],account:account.address});
    const hash=await wallet.writeContract({...sim.request,account});
    const receipt=await client.waitForTransactionReceipt({hash});
    if(receipt.status!=='success') throw new Error('mint reverted '+hash);
    for(const log of receipt.logs){ if(log.address.toLowerCase()!==REGISTRAR.toLowerCase()) continue;
      try{const d=decodeEventLog({abi:[MINT_EVENT],data:log.data,topics:log.topics});
        if(d.eventName==='SubnameMinted'){ tokenId=d.args.tokenId; }}catch{} }
    if(tokenId===null) throw new Error('no SubnameMinted in '+hash);
    console.log('minted hopr1.vault.gno tokenId',tokenId.toString(),'tx',hash);
  }
  console.log('step1b ownerOf');
  const holder=await client.readContract({address:REGISTRAR,abi:KEY_REGISTRAR_ABI,functionName:'ownerOf',args:[tokenId]});
  console.log('key holder',holder);
  if(holder.toLowerCase()!==OWNER.toLowerCase()) throw new Error('key NFT not held by owner');

  console.log('step2 deployGnosisTba');
  // Step 2 (deploy + initialize + verify)
  const tba=await deployGnosisTba({sourceChainId:100,contractAddress:REGISTRAR,tokenId},wallet);
  console.log('TBA',tba.tbaAddress,'deployTx',tba.deployTxHash??'(existing)','initTx',tba.initializeTxHash??'(slot set)');

  console.log('step3 createSafe');
  // Step 3 [TBA, OWNER recovery] threshold 1
  const safe=await createSafeForByoMolt(`${LABEL}.${TLD}`,tba.tbaAddress,key,OWNER);
  if(!safe.safeAddress) throw new Error('safe: '+safe.error);
  console.log('Safe',safe.safeAddress,safe.alreadyExisted?'(existing)':'(new)');

  console.log('step4 verifyExec');
  // Step 4 execution path end-to-end (eth_call as NFT owner)
  await verifySafeKeyExecution(client,safe.safeAddress,tba.tbaAddress,OWNER);
  console.log('execution simulation PASSED');
  console.log(JSON.stringify({keyNft:`hopr1.vault.gno`,tokenId:tokenId.toString(),contract:REGISTRAR,owner:OWNER,tba:tba.tbaAddress,safe:safe.safeAddress,governance:'shared-recovery'}));
})().catch(e=>{console.error('RECOVERY FAILED:',e);if(e.details)console.error('details:',e.details);if(e.cause)console.error('cause:',e.cause?.shortMessage||e.cause?.message||e.cause);process.exit(1)});
