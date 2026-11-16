import type { ClientRequest, ClientView, PartySnapshot, PlayerPublic } from '@huddle/shared';
import { createContext, useContext, useEffect, useState } from 'react';
import { create } from 'zustand';
import { buzz, HAPTIC } from '../lib/haptics';
import { friendlyError } from '../lib/markets';
import type { PartyClient } from '../lib/session';

export interface PartyCtxValue {
  client: PartyClient;
  view: ClientView;
  snap: PartySnapshot;
  /** My public key. */
  me: string;
  meP: PlayerPublic | undefined;
  points: boolean;
  /** Available cash, base units. */
  balance: number;
  remote: boolean;
}

export const PartyCtx = createContext<PartyCtxValue | null>(null);

export function useParty(): PartyCtxValue {
  const v = useContext(PartyCtx);
  if (!v) throw new Error('useParty outside PartyCtx');
  return v;
}

/** Engine time, re-rendered every `ms`. */
export function useNow(ms = 250): number {
  const { client } = useParty();
  const [now, setNow] = useState(() => client.now());
  useEffect(() => {
    const t = setInterval(() => setNow(client.now()), ms);
    return () => clearInterval(t);
  }, [client, ms]);
  return now;
}

/** Send a request with haptics; resolves to null on success or a friendly error message. */
export async function act(client: PartyClient, body: ClientRequest): Promise<string | null> {
  buzz(HAPTIC.tap);
  try {
    await client.request(body);
    buzz(HAPTIC.success);
    return null;
  } catch (e) {
    buzz(HAPTIC.error);
    return friendlyError(e);
  }
}

/** Small UI flags shared across the live screen. */
interface UiState {
  topUpOpen: boolean;
  setTopUp(open: boolean): void;
}
export const useUi = create<UiState>((set) => ({
  topUpOpen: false,
  setTopUp: (topUpOpen) => set({ topUpOpen }),
}));

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
