import type { ClientMessage, ServerMessage } from '../shared/types';

export class WorldConnection {
  private socket?: WebSocket;
  private attempt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private closed = false;
  constructor(private onMessage: (message: ServerMessage) => void, private onStatus: (online: boolean) => void, private token = '') { this.connect(); }
  private connect() {
    if (this.closed) return;
    const protocols = this.token ? ['ai-world', `token.${this.token}`] : ['ai-world'];
    this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`, protocols);
    this.socket.onopen = () => { this.attempt = 0; this.onStatus(true); };
    this.socket.onmessage = event => {
      try { this.onMessage(JSON.parse(event.data) as ServerMessage); } catch { /* malformed server frame is ignored */ }
    };
    this.socket.onclose = () => {
      this.onStatus(false);
      if (!this.closed) this.retry = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.attempt++, 15000));
    };
    this.socket.onerror = () => this.socket?.close();
  }
  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
  close() { this.closed = true; clearTimeout(this.retry); this.socket?.close(); }
}
