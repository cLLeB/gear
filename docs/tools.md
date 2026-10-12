# Tool tabs

Ten tools open as tabs from the command palette (`Ctrl/Cmd+Shift+P`). None of
them needs anything installed.

## Compare two folders

**Compare two folders…** asks for a left and a right folder. Files are compared
by size and then by content.

- Filter by *Differences*, *Different*, *Only left*, *Only right*, *Same* or *All*.
- A folder that exists on one side only is shown as a single row.
- **Diff** opens the two versions side by side. **Copy →** / **← Copy** writes one
  side's file over the other.
- *Skip* lists names left out of the comparison (`.git`, `node_modules`, … by default).

## Disk usage

**Disk usage: What takes up the space in this folder** measures the workspace;
**Disk usage: Of another folder…** asks for a path. Nothing is skipped, so
`node_modules`, build output and `.git` are counted.

Click a folder to go into it and a file to open it. The list on the right shows
the same level sorted by size.

## Mock API server

**Mock server: Open the mock API server** shows a route table and a request
log. The server listens on `127.0.0.1` only; port `0` picks a free port.

| In a route path | Matches |
|---|---|
| `/users/:id` | one segment, available as `{{params.id}}` |
| `/files/*` | everything after `/files/` |

Earlier routes win; a route that can never be reached is marked.

| In a body | Becomes |
|---|---|
| `{{params.name}}` | a path parameter |
| `{{query.name}}` | a query-string value |
| `{{body}}` | the request body as sent |
| `{{now}}` | the time in milliseconds |
| `{{uuid}}` | a random UUID |

Every response carries permissive CORS headers and `OPTIONS` preflights are
answered, so a page on another port can call the mock. Edits apply while the
server runs. **Save file** / **Load file** write and read `mock-routes.json` in
the workspace folder. A request that matched nothing can be turned into a route
from the log.

## Editor macros

| Command | |
|---|---|
| **Macro: Start / stop recording** | records what you type and the command keys you press in the editor |
| **Macro: Play last recording** | once, at the cursor |
| **Macro: Play last recording N times…** | |
| **Macro: Play last recording to the end of the file** | repeats while the cursor keeps moving down |
| **Macro: Save last recording…** / **Run a saved macro…** / **Delete a saved macro…** | named macros, kept on this machine |
| **Macro: Show what the last recording does** | |

For a macro that should run on every line, end the recording by moving to the
next line.

## Kanban board

**Board: Show this Markdown file as a Kanban board** turns the file in front
into a board; **Board: New task board…** creates one.

```markdown
## To do

- [ ] Write the parser #core @due(2026-01-05)
  an indented line stays with its card

## Done

- [x] Set up the repo
```

- Every `##` heading is a column; every top-level list item under it is a card.
- Drag cards, or use the arrows that appear on a card. Dropping a card into a
  column named *Done*, *Completed*, *Finished*, *Shipped* or *Closed* ticks it.
- `#tags` and `@due(YYYY-MM-DD)` are shown on the card; overdue dates are red.
- Every change is written to the file at once. Everything that is not a card
  (the title, notes, code blocks) is left exactly as it was.

## Time tracking

**Time: Show time tracking**. Tracking is off until you turn it on.

Time counts while Gear is in front and you typed, clicked or scrolled within
the last two minutes. It is split by day, folder, language, file and kind of
work (editing, terminal, other). The data stays in this machine's local
storage; **Copy CSV** gives one row per day and folder, **Delete data** removes
everything.

## Hex editor

**Hex editor: Open a file byte by byte…** or **Hex editor: Open the current file**.

| Key | |
|---|---|
| hex digits | overwrite the byte under the cursor |
| `Tab` | switch between the hex and the text column |
| `Insert` | toggle insert / overwrite |
| `Delete`, `Backspace` | remove bytes |
| `Ctrl/Cmd+G` | go to an offset (`1024`, `0x400`, `+16`) |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+S` | undo, save |

*Find* takes bytes (`48 65 6C`, `0x48,0x65`) or text; put text in quotes when
it could be read as hex (`"cafe"`). The panel on the right reads the bytes at
the cursor as integers, floats and a timestamp, in either byte order. Files
over 16 MB open read-only, first part only.

## Table view

**Table: Open this CSV / TSV file as a table** on a `.csv` or `.tsv` file. The
delimiter (comma, semicolon, tab or pipe), line endings and quoting are
detected and kept when saving.

| Filter | Keeps rows where |
|---|---|
| `london ada` | both words appear somewhere |
| `name:ada` | the column starting with "name" contains "ada" |
| `age>30`, `age<=5` | the number in that column compares so |
| `city=Paris`, `city!=Paris` | the column equals / does not equal |

Click a header to sort and `⋯` for column actions. `Enter` or a double click
edits a cell. The bar at the bottom shows the selected column's count, distinct
values, sum, average, minimum and maximum over the rows shown.

## WebSocket client

**WebSocket: Open the WebSocket client**. `localhost:3000/socket` becomes
`ws://…`; any other host becomes `wss://…`. Plain `ws://` works for this
machine only.

Send with `Ctrl/Cmd+Enter`. Click a log line to see it in full (JSON is
formatted). *Reconnect* retries with growing pauses when the connection drops.

## Regex workbench

**Regex: Open the regex workbench**. A selection in the editor becomes the
sample text.

- **Matches** lists every match with its numbered and named groups.
- **Replace** previews a replacement (`$1`, `$<name>`, `$&`).
- **Explain** walks through the pattern piece by piece.
- **Code** writes it for JavaScript, Python, Go, Rust or grep.

Matching uses the JavaScript engine, so other languages can differ in details
such as lookbehind and Unicode classes.
