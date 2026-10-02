import { createPublicClient, http } from 'viem';
import { robinhoodChain } from './chain';

export const client = createPublicClient({ chain: robinhoodChain, transport: http() });
