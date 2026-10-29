/**
 * Opt-in smart replies: ask the AI for up to three short replies to the current
 * conversation, debounced, cached per chat and throttled.
 *
 * Contract (server side being built in parallel):
 *   POST /api/ai/suggest-replies { chatId } -> { suggestions: string[] }
 * Any failure (404 route not deployed yet, timeout, provider down) degrades
 * silently to "no chips" — the composer never shows an error for this.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { hydrateSuggestedReplies, useSuggestedRepliesPref } from './settingsPrefs';

const DEBOUNCE_MS = 1500;
const MIN_INTERVAL_MS = 10_000;
const CACHE_TTL_MS = 60_000;
const MAX_SUGGESTIONS = 3;

interface CacheEntry {
  suggestions: string[];
  at: number;
}

const cache = new Map<string, CacheEntry>();
const lastRequestAt = new Map<string, number>();

/** Tolerant parse: array or {suggestions|replies|items: string[]}. */
export function parseSmartReplies(payload: unknown): string[] {
  const record = (payload ?? {}) as Record<string, unknown>;
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(record.suggestions)
      ? record.suggestions
      : Array.isArray(record.replies)
        ? record.replies
        : Array.isArray(record.items)
          ? record.items
          : [];
  const seen = new Set<string>();
  const replies: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const text = candidate.trim();
    if (!text || text.length > 320) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    replies.push(text);
    if (replies.length >= MAX_SUGGESTIONS) break;
  }
  return replies;
}

/** Identity of the latest message, used to re-request after new activity. */
export function messageKeyOf(messages: { id: string; sentAt?: string }[] | undefined): string {
  const last = messages && messages.length > 0 ? messages[messages.length - 1] : undefined;
  return `${messages?.length ?? 0}:${last?.id ?? ''}:${last?.sentAt ?? ''}`;
}

/**
 * @param chatId open conversation id
 * @param messageKey changes whenever the conversation changed (see messageKeyOf)
 * @param paused true while the composer is busy/recording — no request then
 */
export function useSmartReplies(
  chatId: string,
  messageKey: string,
  paused = false,
): { suggestions: string[]; dismiss: () => void } {
  const [enabled] = useSuggestedRepliesPref();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const timer = useRef<number | null>(null);
  const requestId = useRef(0);

  // Reset chips when switching chats, and mirror the account opt-in once.
  useEffect(() => {
    setSuggestions([]);
  }, [chatId]);

  useEffect(() => {
    void hydrateSuggestedReplies();
  }, []);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!enabled || !chatId || paused) {
      setSuggestions([]);
      return undefined;
    }
    // Fresh cache wins for 60 s (avoids re-asking on every re-render/back).
    const cached = cache.get(chatId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setSuggestions(cached.suggestions);
    } else {
      setSuggestions([]);
    }
    timer.current = window.setTimeout(() => {
      const now = Date.now();
      const last = lastRequestAt.get(chatId) ?? 0;
      if (now - last < MIN_INTERVAL_MS) return;
      lastRequestAt.set(chatId, now);
      const id = requestId.current + 1;
      requestId.current = id;
      void api
        .request<unknown>('/api/ai/suggest-replies', { method: 'POST', body: { chatId } })
        .then((payload) => {
          if (requestId.current !== id) return;
          const parsed = parseSmartReplies(payload);
          cache.set(chatId, { suggestions: parsed, at: Date.now() });
          setSuggestions(parsed);
        })
        .catch(() => {
          // Silent by design: a missing route or provider failure means no chips.
          if (requestId.current === id) setSuggestions([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [chatId, enabled, messageKey, paused]);

  const dismiss = useCallback(() => {
    setSuggestions([]);
    cache.delete(chatId);
  }, [chatId]);

  return { suggestions, dismiss };
}

