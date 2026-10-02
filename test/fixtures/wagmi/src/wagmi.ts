import { createConfig, http } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import { robinhood } from './chains';

export const config = createConfig({
  chains: [robinhood],
  connectors: [walletConnect({ projectId: '' })],
  transports: { [robinhood.id]: http() },
});

// WalletConnect namespaces use CAIP-2 chain ids.
export const namespaces = { eip155: { chains: ['eip155:4663'] } };
