import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChatMessage } from "@flowstore/core/llm/types";
import { debouncedLocalStorage } from "./scopedStorage";

type MessagesUpdater = ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]);

interface ChatState {
  // The Assistant conversation. Persisted (under "flowstore:chat") so it
  // survives a panel close, reload, or HMR re-eval — previously it lived in
  // ChatPanel's local useState and was destroyed on every unmount. The chat is
  // scoped to the active spec: loadSpec clears it (its messages embed the spec
  // and the discussion is about it), so swapping specs starts a fresh
  // transcript. Persistence keeps the conversation alive across panel
  // close/reload/HMR *within* a single spec, not across a spec swap.
  messages: ChatMessage[];
  // Mirrors React's setState signature (value or updater) so it's a drop-in
  // replacement for the useState setter ChatPanel used to call.
  setMessages: (updater: MessagesUpdater) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      setMessages: (updater) =>
        set((s) => ({
          messages: typeof updater === "function" ? updater(s.messages) : updater,
        })),
      clear: () => set({ messages: [] }),
    }),
    {
      name: "flowstore:chat",
      // Debounced: the agent loop fires setMessages several times per turn and
      // each message can embed the whole spec, so coalesce writes rather than
      // re-serializing the transcript on every step.
      storage: createJSONStorage(() => debouncedLocalStorage()),
      partialize: (s) => ({ messages: s.messages }),
    },
  ),
);
