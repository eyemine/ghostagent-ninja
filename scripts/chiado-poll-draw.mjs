import { createPublicClient, http } from 'viem';
import { gnosisChiado } from 'viem/chains';

const c = createPublicClient({ chain: gnosisChiado, transport: http('https://rpc.chiado.gnosis.gateway.fm') });
const DRAW_TX = '0x8a0b040842d354f95fbddcffbd3d85f5564b65459bf3fa2c28bdb16db537a0ce';
const CURSOR  = '0x5235249f1409a315349036af4ea914a9efdb7cbf';
const ID      = '0xb111dc70dda0cd9874046258b157c898cdd891483d954b1fc8231ada010e4a34';
const SCOPE   = '0xcfee7c08a98f4b565d124c7e4e28acc52e1bc780e3887db0a02a7d2d5bc66728';
const ABI     = [{name:'leafSpent',type:'function',stateMutability:'view',inputs:[{name:'id',type:'bytes32'},{name:'scopeId',type:'bytes32'}],outputs:[{name:'',type:'uint256'}]}];

console.log('Polling for draw tx (90s)...');
const r = await c.waitForTransactionReceipt({ hash: DRAW_TX, timeout: 90_000, pollingInterval: 4_000 });
console.log('status:', r.status, '| block:', r.blockNumber.toString());
const spent = await c.readContract({ address: CURSOR, abi: ABI, functionName: 'leafSpent', args: [ID, SCOPE] });
console.log('leafSpent:', spent.toString(), 'wei', `(${Number(spent)/1e18} xDAI)`);
