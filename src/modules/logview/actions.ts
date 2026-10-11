// Palette commands for the log viewer.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox } from "@/modules/quick-pick";
import { LOG_SCHEME } from "./model";

export const LOG_ACTIONS = [
  {
    id: "log.openActive",
    label: "Logs: Open the current file in the log viewer",
    keywords: ["log", "viewer", "tail", "big file", "large file", "filter"],
    run: () => {
      const p = getActiveEditor()?.path;
      if (!p) return void toast.info("Open a file first");
      app().openFile(`${LOG_SCHEME}${p.replace(/\\/g, "/")}`);
    },
  },
  {
    id: "log.open",
    label: "Logs: Open a log file…",
    keywords: ["log", "viewer", "tail", "syslog", "nginx", "access log"],
    run: async () => {
      const p = (await inputBox({ title: "Log file", placeholder: "/var/log/syslog" }))?.trim();
      if (p) app().openFile(`${LOG_SCHEME}${p.replace(/\\/g, "/")}`);
    },
  },
];
