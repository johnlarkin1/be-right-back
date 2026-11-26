/**
 * casperDraftStore - A question another screen hands to Ask Casper.
 *
 * The topic map sets a draft, then switches to the Ask Casper tab.
 * CasperChat puts the draft in its input and clears it.
 */
import { create } from "zustand";

interface CasperDraftState {
  draft: string | null;
  setDraft: (draft: string | null) => void;
}

export const useCasperDraftStore = create<CasperDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
}));
