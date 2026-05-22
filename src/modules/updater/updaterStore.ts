import { create } from "zustand";
import type { UpdaterStatus } from "./useUpdater";

interface UpdaterStore {
  status: UpdaterStatus;
  setStatus: (s: UpdaterStatus) => void;
}

export const useUpdaterStore = create<UpdaterStore>((set) => ({
  status: { kind: "idle" },
  setStatus: (status) => set({ status }),
}));
