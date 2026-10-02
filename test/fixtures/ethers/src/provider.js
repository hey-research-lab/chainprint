import { ethers } from 'ethers';

export const provider = new ethers.JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com', 4663);

// Uniswap V2 factory on Robinhood Chain.
export const V2_FACTORY = '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f';

export async function factoryCode() {
  return provider.getCode(V2_FACTORY);
}
