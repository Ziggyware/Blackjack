import { TableHost } from '@velvet/shared';
import type { HostEvent, HostOptions } from '@velvet/shared';

export interface RoomMeta {
  roomId: string;
  name: string;
  code: string;
  tagline: string;
  accent: number;
  isPrivate: boolean;
  createdAt: number;
  lastEmptyAt: number;
}

export class Room {
  readonly host: TableHost;
  readonly meta: RoomMeta;

  constructor(meta: RoomMeta, opts: HostOptions, onEvent?: (e: HostEvent) => void) {
    this.meta = meta;
    this.host = new TableHost({ ...opts, onEvent });
    this.host.start();
  }

  get isEmpty(): boolean { return this.host.sessionCount === 0; }

  destroy(): void { this.host.stop(); }
}
