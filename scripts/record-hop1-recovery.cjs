const fs=require('fs'),path=require('path');
const root='/Users/richieogorman/CascadeProjects/ghostagent_ninja';
for(const f of ['.env','.env.local']) { const p=path.join(root,f);
  if(fs.existsSync(p)) for(const line of fs.readFileSync(p,'utf8').split('\n')) {
    const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); } }
const {createWalletClient,createPublicClient,http,keccak256,encodePacked,parseAbi}=require('viem');
const {privateKeyToAccount}=require('viem/accounts');
const {gnosis}=require('viem/chains');
const W='https://nftmail-email-worker.richard-159.workers.dev';
const WS=process.env.WORKER_SECRET, WH=process.env.WEBHOOK_SECRET;
const OWNER='0xf251ca37a80200f7afeff398da0338f4c1f01249';
const TBA='0x1D3a56EC96Ccc6CE6bbF59a6BBdEc2e6b6Bb7D64', SAFE='0x4ba1Dc282fbc1bea6Ee79fE485B01521BC23Da9C';
const KEY={name:'hopr1.vault.gno',contract:'0xc6b184a38da64d1d535674dafb9ce2440058ec4e',tokenId:'2'};
const OLD={keyNft:'hopr1.agent.gno',tokenId:'12',safe:'0xEEe8AC0c7db48476bDA0529140b3cf496d21647c',tba:'0x2598FAC1a5eAb3573d263F96A40117748698C732'};
async function call(body){const r=await fetch(W,{method:'POST',headers:{'Content-Type':'application/json','X-Worker-Secret':WS},body:JSON.stringify(body)});const j=await r.json().catch(()=>({_status:r.status}));console.log(body.action,body.key||body.agentName||body.label,'->',r.status,JSON.stringify(j).slice(0,160));return j;}
(async()=>{
  await call({action:'kvPut',key:'tba:hopr1',value:JSON.stringify({
    tbaAddress:TBA,sourceChainId:100,nftType:'gno-key',tokenId:KEY.tokenId,contract:KEY.contract,
    keyName:KEY.name,governance:'shared-recovery',
    pairedNft:{sourceChainId:1,contract:'0xf60aba43e1f7f3dab1186ff03b561401c9df85e2',tokenId:'99485736816552419463145076820115745998946380182418170917680580526852355915776',nftType:'ens',name:'hopr1.eth',ensv2:true},
    supersedes:{...OLD,reason:'359-byte stub TBA could not sign; Safe had no usable owner'},
    storedAt:Date.now()}),ownerAddress:OWNER,webhookSecret:WH});
  for(const name of ['hopr1','hopr1_']) {
    await call({action:'setAgentRecord',secret:WH,agentName:name,tba:TBA,safe:SAFE});
    await call({action:'registerSovereign',secret:WH,label:name,controller:OWNER,originNft:KEY.name,accountTier:'lite',safe:SAFE});
  }
  await call({action:'setErc8004AgentId',agentName:'hopr1',erc8004AgentId:4187,agentURI:'https://ghostagent.ninja/api/agent-card?agent=hopr1',chainId:100,safeOwner:SAFE});
  // On-chain: resolver setSafe for hopr1.vault.gno subnode
  const key=process.env.TREASURY_PRIVATE_KEY;
  const account=privateKeyToAccount(key);
  const wallet=createWalletClient({chain:gnosis,transport:http('https://rpc.gnosischain.com'),account});
  const client=createPublicClient({chain:gnosis,transport:http('https://rpc.gnosischain.com')});
  const parent='0xca63a47ebf42451e19c747fe7674898aac15e2b132dd9545ebe97f472bb5c0b2';
  const labelHash=keccak256(encodePacked(['string'],['hopr1']));
  const subnode=keccak256(encodePacked(['bytes32','bytes32'],[parent,labelHash]));
  const RESOLVER='0xc97c7166b7445a6997e22f022d58af7984be5508';
  const abi=parseAbi(['function setSafe(bytes32 subnodeKey,address safe)','function safe(bytes32) view returns(address)']);
  const hash=await wallet.writeContract({address:RESOLVER,abi,functionName:'setSafe',args:[subnode,SAFE],account});
  const rc=await client.waitForTransactionReceipt({hash});
  console.log('setSafe tx',hash,rc.status);
  try{console.log('resolver.safe',await client.readContract({address:RESOLVER,abi,functionName:'safe',args:[subnode]}));}catch(e){console.log('safe read n/a',e.shortMessage)}
})().catch(e=>{console.error('ERR',e.shortMessage||e.message||e);process.exit(1)});
