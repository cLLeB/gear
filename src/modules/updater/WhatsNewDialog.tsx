import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";

const LAST_VERSION_KEY = "Gear:last-seen-version";
const RELEASES_URL = "https://github.com/cLLeB/gear/releases";

export function WhatsNewDialog() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const current = await getVersion();
        const last = localStorage.getItem(LAST_VERSION_KEY);
        localStorage.setItem(LAST_VERSION_KEY, current);
        if (last && last !== current) {
          setVersion(current);
        }
      } catch {
        // Non-critical — ignore in web dev mode.
      }
    })();
  }, []);

  if (!version) return null;

  return (
    <Dialog open onOpenChange={() => setVersion(null)}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Updated to Gear v{version}</DialogTitle>
          <DialogDescription>
            Gear has been updated. See the release notes for what changed in
            this version.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setVersion(null)}>
            Dismiss
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void openUrl(`${RELEASES_URL}/tag/v${version}`);
              setVersion(null);
            }}
          >
            View release notes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
