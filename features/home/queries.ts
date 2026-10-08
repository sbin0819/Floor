import { cache } from "react";
import { createHomeQueries } from "./query-factory";

export const getHomeTodo = cache(() => createHomeQueries().getHomeTodo());
export const getHomeChecklist = cache(() =>
  createHomeQueries().getHomeChecklist(),
);
export const getHomeRecentChats = cache(() =>
  createHomeQueries().getHomeRecentChats(),
);
