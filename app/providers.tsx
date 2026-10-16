"use client";

import {
  environmentManager,
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  notifySessionExpired,
  sessionNoticeGeneration,
} from "@/lib/errors/session-expired";
import { isRequestCanceled } from "@/lib/http/errors";
import { isSessionExpired } from "@/lib/errors/messages";

export function makeQueryClient() {
  const started = new WeakMap<object, number>();
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        notifySessionExpired(client, error, started.get(query));
      },
    }),
    mutationCache: new MutationCache({
      onMutate: (_variables, mutation) => {
        started.set(mutation, sessionNoticeGeneration(client));
      },
      onError: (error, _variables, _result, mutation) => {
        notifySessionExpired(client, error, started.get(mutation));
      },
      onSuccess: (data, _variables, _result, mutation) => {
        if (
          data &&
          typeof data === "object" &&
          "ok" in data &&
          data.ok === false
        )
          notifySessionExpired(client, data, started.get(mutation));
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        retry: (count, error) =>
          !environmentManager.isServer() &&
          !isRequestCanceled(error) &&
          !isSessionExpired(error) &&
          count < 3,
      },
    },
  });
  client.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "fetch")
      started.set(event.query, sessionNoticeGeneration(client));
  });
  return client;
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (environmentManager.isServer()) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
