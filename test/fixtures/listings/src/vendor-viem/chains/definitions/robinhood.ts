// A copy of a chain library's definition, kept in the tree.
import { defineChain } from '../../utils/chain/defineChain.js';

export const robinhood = /*#__PURE__*/ defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});
