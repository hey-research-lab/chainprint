/**
 * No test may touch the network.
 *
 * chainprint makes no network call of any kind, so anything reaching the real
 * `fetch` or opening a socket is a bug: fail loudly instead of connecting.
 */
import net from 'node:net';

const blocked = async (input: unknown): Promise<never> => {
  const target = typeof input === 'string' ? input : String(input);
  throw new Error(`Network access is disabled in tests. Something tried to fetch ${target}.`);
};

globalThis.fetch = blocked as unknown as typeof fetch;

net.Socket.prototype.connect = function connect(): never {
  throw new Error('Network access is disabled in tests. Something tried to open a socket.');
} as unknown as typeof net.Socket.prototype.connect;
