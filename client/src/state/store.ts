import { create } from 'zustand';
import type { ClientMsg, RoomSummary, ServerMsg, TableView } from '@velvet/shared';
import { connect } from '../net/connection.js';
import type { ConnKind, ConnState, Connection } from '../net/connection.js';
import { fxBus } from '../fx/bus.js';
import { sound } from '../audio/sound.js';

export type PanelTab = 'table' | 'history' | 'ranks' | 'rules';

const LS_IDENTITY = 'velvet.identity.v1';
const LS_SETTINGS = 'velvet.settings.v1';

interface SavedIdentity { name: string; hue: number }
interface SavedSettings { sound: boolean; coach: boolean; panel: boolean; tab: PanelTab }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as object) } as T : fallback;
  } catch { return fallback; }
}
function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export const savedIdentity = load<SavedIdentity>(LS_IDENTITY, {
  name: '',
  hue: Math.floor(Math.random() * 360),
});
const savedSettings = load<SavedSettings>(LS_SETTINGS, { sound: true, coach: true, panel: true, tab: 'table' });

function tokenKey(roomId: string): string { return `velvet.token.${roomId}`; }

interface Store {
  booted: boolean;
  status: ConnState;
  kind: ConnKind | null;
  latency: number | null;
  you: string | null;
  roomId: string | null;
  rooms: RoomSummary[];
  table: TableView | null;
  clockOffset: number;
  name: string;
  hue: number;
  atTable: boolean;
  error: string | null;
  soundOn: boolean;
  coachOn: boolean;
  panelOpen: boolean;
  tab: PanelTab;
  lastActionAt: number;

  boot: () => Promise<void>;
  enter: (opts: { name: string; hue: number; roomId?: string | null; code?: string | null; seat?: number | null }) => void;
  leaveTable: () => void;
  send: (msg: ClientMsg) => void;
  setSound: (on: boolean) => void;
  setCoach: (on: boolean) => void;
  setPanel: (open: boolean) => void;
  setTab: (tab: PanelTab) => void;
  setIdentity: (name: string, hue: number) => void;
  clearError: () => void;
}

let conn: Connection | null = null;
let errorTimer: ReturnType<typeof setTimeout> | null = null;

function apply(msg: ServerMsg, set: (partial: Partial<Store>) => void, get: () => Store): void {
  switch (msg.type) {
    case 'welcome':
      set({ rooms: msg.rooms, clockOffset: msg.serverTime - Date.now() });
      break;
    case 'rooms':
      set({ rooms: msg.rooms });
      break;
    case 'joined': {
      set({ you: msg.you, roomId: msg.roomId, atTable: true, error: null });
      if (msg.token && msg.token !== 'local') {
        try { localStorage.setItem(tokenKey(msg.roomId), msg.token); } catch { /* ignore */ }
      }
      break;
    }
    case 'table': {
      set({
        table: msg.state,
        clockOffset: msg.state.serverTime - Date.now(),
      });
      for (const fx of msg.fx) fxBus.emit(fx);
      break;
    }
    case 'lobby':
      set({ table: msg.state });
      break;
    case 'error': {
      set({ error: msg.message });
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = setTimeout(() => {
        if (get().error === msg.message) set({ error: null });
      }, 2600);
      break;
    }
    case 'pong':
      break;
  }
}

export const useStore = create<Store>((set, get) => ({
  booted: false,
  status: 'idle',
  kind: null,
  latency: null,
  you: null,
  roomId: null,
  rooms: [],
  table: null,
  clockOffset: 0,
  name: savedIdentity.name,
  hue: savedIdentity.hue,
  atTable: false,
  error: null,
  soundOn: savedSettings.sound,
  coachOn: savedSettings.coach,
  panelOpen: savedSettings.panel,
  tab: savedSettings.tab,
  lastActionAt: 0,

  async boot() {
    if (get().booted) return;
    set({ booted: true, status: 'connecting' });
    sound.setMuted(!get().soundOn);
    conn = await connect({
      onMessage: (m) => apply(m, set as (p: Partial<Store>) => void, get),
      onState: (kind, state, latency) => set({ kind, status: state, latency: latency ?? get().latency }),
    });
    const kind = conn.kind;
    set({ kind, status: kind === 'local' ? 'offline' : 'open' });
    conn.send({ type: 'hello', name: get().name || 'Guest', hue: get().hue, token: null });
  },

  enter({ name, hue, roomId, code, seat }) {
    set({ name, hue });
    save(LS_IDENTITY, { name, hue });
    sound.unlock();
    if (!conn) return;
    let token: string | null = null;
    if (roomId) {
      try { token = localStorage.getItem(tokenKey(roomId)); } catch { token = null; }
    }
    conn.send({ type: 'join', payload: { name, hue, token, roomId: roomId ?? null, code: code ?? null, seat: seat ?? null } });
    set({ lastActionAt: Date.now() });
  },

  leaveTable() {
    conn?.send({ type: 'leaveSeat' });
    set({ atTable: false, you: null, roomId: null });
    conn?.send({ type: 'listRooms' });
  },

  send(msg) {
    if (!conn) return;
    conn.send(msg);
    set({ lastActionAt: Date.now() });
  },

  setSound(on) {
    set({ soundOn: on });
    sound.setMuted(!on);
    if (on) { sound.unlock(); sound.play('click'); }
    save(LS_SETTINGS, { ...savedSettings, sound: on, coach: get().coachOn, panel: get().panelOpen, tab: get().tab });
  },
  setCoach(on) {
    set({ coachOn: on });
    save(LS_SETTINGS, { ...savedSettings, sound: get().soundOn, coach: on, panel: get().panelOpen, tab: get().tab });
  },
  setPanel(open) {
    set({ panelOpen: open });
    save(LS_SETTINGS, { ...savedSettings, sound: get().soundOn, coach: get().coachOn, panel: open, tab: get().tab });
  },
  setTab(tab) {
    set({ tab, panelOpen: true });
    save(LS_SETTINGS, { ...savedSettings, sound: get().soundOn, coach: get().coachOn, panel: get().panelOpen, tab });
  },
  setIdentity(name, hue) {
    set({ name, hue });
    save(LS_IDENTITY, { name, hue });
  },
  clearError() { set({ error: null }); },
}));

/** server-aligned clock, so countdowns survive latency */
export function serverNow(): number {
  return Date.now() + useStore.getState().clockOffset;
}

export function connection(): Connection | null { return conn; }
