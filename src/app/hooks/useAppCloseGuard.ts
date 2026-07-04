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

export function useAppCloseGuard(tabsRef: RefObject<Tab[]>) {
	const [pendingAppClose, setPendingAppClose] = useState(false);
	const forceClose = useRef(false);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;
		void getCurrentWindow()
			.onCloseRequested(async (event) => {
				if (forceClose.current) return;
				event.preventDefault();
				if (await anyTerminalBusy(tabsRef.current)) {
					setPendingAppClose(true);
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
		setPendingAppClose(false);
		forceClose.current = true;
		forceCloseWindow();
	}, []);

	const cancelAppClose = useCallback(() => setPendingAppClose(false), []);

	return { pendingAppClose, confirmAppClose, cancelAppClose };
}
