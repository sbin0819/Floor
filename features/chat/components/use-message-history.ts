"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { requestMessagePage } from "../message-requests";
import {
  mergeChatMessages,
  roomMessagesKey,
  type DisplayMessage,
} from "./message-state";

export function useMessageHistory(
  roomId: string,
  userId: string,
  oldestSeq: number | null,
  resetVersion: number,
) {
  const client = useQueryClient();
  const key = `${roomId}:${resetVersion}`;
  const lifecycle = useRef({
    key,
    active: true,
    request: null as AbortController | null,
  });
  const [state, setState] = useState({
    key,
    loading: false,
    exhausted: false,
    error: false,
  });
  const current =
    state.key === key
      ? state
      : { loading: false, exhausted: false, error: false };
  const hasMore = !current.exhausted && oldestSeq !== null && oldestSeq > 1;

  useEffect(() => {
    const current = {
      key,
      active: true,
      request: null as AbortController | null,
    };
    lifecycle.current = current;
    return () => {
      current.active = false;
      current.request?.abort();
    };
  }, [key]);

  const loadOlder = useCallback(
    async (maxMessages?: number) => {
      const current = lifecycle.current;
      if (
        !hasMore ||
        current.request ||
        !current.active ||
        current.key !== key ||
        oldestSeq === null
      )
        return;
      const request = new AbortController();
      request.signal.addEventListener(
        "abort",
        () => {
          setState((previous) =>
            previous.key === key && previous.loading
              ? { ...previous, loading: false }
              : previous,
          );
        },
        { once: true },
      );
      current.request = request;
      setState({ key, loading: true, exhausted: false, error: false });
      try {
        const page = await requestMessagePage(
          client,
          roomId,
          { before: oldestSeq },
          { signal: request.signal },
        );
        if (!current.active || request.signal.aborted) return;
        let clipped = false;
        client.setQueryData<DisplayMessage[]>(
          roomMessagesKey(roomId),
          (messages = []) => {
            const remaining =
              maxMessages === undefined
                ? page.messages.length
                : Math.max(
                    0,
                    maxMessages -
                      messages.filter((message) => !message.delivery).length,
                  );
            clipped = remaining < page.messages.length;
            const incoming =
              remaining === 0 ? [] : page.messages.slice(-remaining);
            return mergeChatMessages(messages, incoming, userId);
          },
        );
        setState({
          key,
          loading: false,
          exhausted: !page.hasMore && !clipped,
          error: false,
        });
      } catch {
        if (current.active && !request.signal.aborted)
          setState({ key, loading: false, exhausted: false, error: true });
      } finally {
        if (current.request === request) current.request = null;
      }
    },
    [client, hasMore, key, oldestSeq, roomId, userId],
  );
  return { hasMore, loading: current.loading, error: current.error, loadOlder };
}
