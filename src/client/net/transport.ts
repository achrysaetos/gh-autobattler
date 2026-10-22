import type { ClientMessage, ServerMessage } from '../../protocol.ts';

export interface TransportHandlers {
  onMessage(msg: ServerMessage): void;
  onClose(): void;
}

export interface Transport {
  send(msg: ClientMessage): void;
  close(): void;
}

export type Connect = (handlers: TransportHandlers) => Transport;

const SERVER_TYPES = new Set(['hello', 'inputs', 'check', 'player', 'feed', 'round']);

function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const msg: unknown = JSON.parse(raw);
    if (typeof msg === 'object' && msg !== null && SERVER_TYPES.has((msg as { type?: string }).type ?? '')) return msg as ServerMessage;
  } catch {
    return null;
  }
  return null;
}

export const connectWebSocket: Connect = (handlers) => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    handlers.onClose();
  };
  ws.onmessage = (e) => {
    const msg = parseServerMessage(e.data);
    if (msg) handlers.onMessage(msg);
  };
  ws.onclose = close;
  ws.onerror = () => ws.close();
  return {
    send(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      ws.onclose = null;
      ws.close();
    },
  };
};
