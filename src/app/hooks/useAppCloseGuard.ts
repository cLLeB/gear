import { getCurrentWindow } from "@tauri-apps/api/window";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { Tab } from "@/modules/tabs";
import { leafHasForegroundProcess, leafIds } from "@/modules/terminal";

async function anyTerminalBusy(tabs: Tab[]): Promise<boolean> {
	try {
		const leaves = tabs.flatMap((t) =>
			t.kind === "terminal" ? leafIds(t.paneTree) : [],
		);
		if (leaves.length === 0) return false;
		const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
		return checks.some(Boolean);
	} catch {
		// A failed busy check must never wedge the window shut.
		return false;
	}
}

// destroy() force-closes without re-entering the close-request cycle. Calling
// close() from inside onCloseRequested is swallowed in Tauri v2, which left the
// window unable to close via the titlebar X or Alt+F4.
function forceCloseWindow(): void {
	void getCurrentWindow().destroy();
}

export type AppCloseBlocker = {
	dirtyEditors: number;
	busyTerminal: boolean;
};

/** Human-readable reason the quit was held, for the confirm dialog. */
export function appCloseMessage(blocker: AppCloseBlocker): string {
	const dirty =
		blocker.dirtyEditors === 1
			? "1 file has unsaved changes"
			: `${blocker.dirtyEditors} files have unsaved changes`;
	if (blocker.dirtyEditors > 0 && blocker.busyTerminal) {
		return `A terminal still has a running process and ${dirty}. Quitting will end it and discard the changes.`;
	}
	if (blocker.dirtyEditors > 0) {
		return `${dirty.charAt(0).toUpperCase()}${dirty.slice(1)}. Quitting will discard them.`;
	}
	return "A terminal still has a running process. Quitting will end it.";
}

export function useAppCloseGuard(tabsRef: RefObject<Tab[]>) {
	const [pendingAppClose, setPendingAppClose] =
		useState<AppCloseBlocker | null>(null);
	const forceClose = useRef(false);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;
		void getCurrentWindow()
			.onCloseRequested(async (event) => {
				if (forceClose.current) return;
				event.preventDefault();
				const dirtyEditors = tabsRef.current.filter(
					(t) => t.kind === "editor" && t.dirty,
				).length;
				const busyTerminal = await anyTerminalBusy(tabsRef.current);
				if (dirtyEditors > 0 || busyTerminal) {
					setPendingAppClose({ dirtyEditors, busyTerminal });
				} else {
					forceClose.current = true;
					forceCloseWindow();
				}
			})
			.then((un) => {
				if (disposed) un();
				else unlisten = un;
			});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [tabsRef]);

	const confirmAppClose = useCallback(() => {
		setPendingAppClose(null);
		forceClose.current = true;
		forceCloseWindow();
	}, []);

	const cancelAppClose = useCallback(() => setPendingAppClose(null), []);

	return { pendingAppClose, confirmAppClose, cancelAppClose };
}
