'use strict';
const fs = require('fs'), path = require('path');
const TYPE_TIER = { Normie:'Standard', Human:'Social', Agent:'Advanced', Cat:'Playful', Alien:'Experimental' };
const TIER_FEATURES = {
  Standard:['email_inbox','basic_chat','identity'],
  Social:['email_inbox','basic_chat','enhanced_social'],
  Advanced:['email_inbox','basic_chat','api_access_preview'],
  Playful:['email_inbox','basic_chat','game_features_preview'],
  Experimental:['email_inbox','basic_chat','beta_access'],
};
const lines = fs.readFileSync(path.join(__dirname,'FakeNormies-manifest.csv'),'utf8').trim().split('\n');
const tokens = lines.map(line => {
  const [svg,adj,typ] = line.trim().split(',');
  if(!svg||!adj||!typ) return null;
  const tokenId = parseInt(svg.replace('.svg',''),10);
  const type = typ.trim();
  const slug = `${adj}.${type}`.toLowerCase();
  const tier = TYPE_TIER[type]||'Standard';
  return { tokenId, svgFilename:svg, name:`${adj} ${type} #${String(tokenId).padStart(2,'0')}`,
    adjective:adj, type, slug,
    ghostAgent:{ tier, email:`${slug}@nftmail.box`, gnoIdentity:`${slug}.agent.gno`,
      features:TIER_FEATURES[tier], dailySends:10, dailyChat:10,
      upgradeUrl:`https://ghostagent.ninja/upgrade/${tokenId}` },
    attributes:[
      {trait_type:'Adjective',value:adj},
      {trait_type:'Type',value:type},
      {trait_type:'GhostAgent Tier',value:tier},
      {trait_type:'Daily Sends',value:10},{trait_type:'Daily Chat',value:10},
      {trait_type:'ERC-8004 Agent',value:'Yes'},{trait_type:'Safe Wallet',value:'Yes'},
      {trait_type:'Chain',value:'Gnosis'} ] };
}).filter(Boolean).sort((a,b)=>a.tokenId-b.tokenId);
// disambiguate duplicate slugs
const seen={};
tokens.forEach(t=>{
  if(seen[t.slug]!==undefined){
    t.slug=`${t.slug}.${t.tokenId}`;
    t.ghostAgent.email=`${t.slug}@nftmail.box`;
    t.ghostAgent.gnoIdentity=`${t.slug}.agent.gno`;
    t.duplicate=true;
  } else { seen[t.slug]=t.tokenId; }
});
const slugIndex={};
tokens.forEach(t=>{ slugIndex[t.slug]=t.tokenId; });
const dist={};
tokens.forEach(t=>{ dist[t.type]=(dist[t.type]||0)+1; });
const manifest={
  collection:{ name:'FakeNormies', symbol:'FNORM', description:'On-chain FakeNormies. Each mint spawns an ERC-8004 agent with a Safe wallet. 10 sends/day + 10 chat/day at Basic.',
    totalSupply:tokens.length, mintPrice:'0', maxPerWallet:1, contractAddress:'', chainId:100, chain:'Gnosis',
    tiers:{ Basic:'Free with NFT (10 sends + 10 chat/day)', Pro:'10 USDC one-time (50 sends + unlimited chat)', Premium:'24 USDC/year (unlimited + delegation + treasury)' } },
  distribution:dist, slugIndex, tokens };
fs.writeFileSync(path.join(__dirname,'manifest.json'), JSON.stringify(manifest,null,2));
console.log(`✓ manifest.json — ${tokens.length} tokens`);
const dupes=tokens.filter(t=>t.duplicate);
if(dupes.length) console.log('  ⚠ duplicates disambiguated:',dupes.map(t=>t.slug));
