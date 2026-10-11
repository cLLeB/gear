// Palette commands for the HTTP client.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { isHttpFile, sendAll, sendAt } from "./store";

function activeHttp() {
  const ed = getActiveEditor();
  const path = ed?.path?.replace(/\\/g, "/");
  if (!ed || !path || !isHttpFile(path)) {
    toast.info("Open a .http or .rest file first");
    return null;
  }
  return { ed, path };
}

const SAMPLE = `# Requests separated by ###. Send with ▶ in the gutter or Ctrl/⌘+Enter.
@host = https://httpbin.org

### Simple GET
GET {{host}}/get?client=gear
Accept: application/json

### Log in — the response is stored under the name "login"
# @name login
POST {{host}}/anything
Content-Type: application/json

{"user": "ada", "requestId": "{{$uuid}}", "at": {{$timestamp}}}

> {%
  client.test("ok", () => client.assert(response.status === 200, "status " + response.status));
  client.global.set("user", response.body.json.user);
%}

### Uses the login response (sent automatically first if needed)
GET {{host}}/headers
X-User: {{login.response.body.$.json.user}}
X-Global: {{user}}
`;

async function newHttpFile(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return void toast.error("Open a folder first");
  let path = `${root}/requests.http`;
  for (let i = 2; (await native.readFile(path).catch(() => null))?.kind === "text"; i++) path = `${root}/requests-${i}.http`;
  await native.writeFile(path, SAMPLE, "user");
  app().openFile(path);
}

export const HTTP_ACTIONS = [
  {
    id: "http.send",
    label: "HTTP: Send request under cursor",
    keywords: ["http", "rest", "request", "api", "send", "postman", "curl"],
    run: () => {
      const a = activeHttp();
      if (a) void sendAt(a.path, a.ed.view.state.doc.toString(), a.ed.view.state.doc.lineAt(a.ed.view.state.selection.main.head).number - 1);
    },
  },
  {
    id: "http.sendAll",
    label: "HTTP: Run all requests in file",
    keywords: ["http", "rest", "requests", "run all", "api tests"],
    run: () => {
      const a = activeHttp();
      if (a) void sendAll(a.path, a.ed.view.state.doc.toString());
    },
  },
  { id: "http.new", label: "HTTP: New request file (.http)", keywords: ["http", "rest", "client", "postman", "api", "new"], run: () => void newHttpFile() },
];
