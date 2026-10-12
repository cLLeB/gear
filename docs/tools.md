# Tool tabs

Twenty tools open as tabs from the command palette (`Ctrl/Cmd+Shift+P`). None of
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

## Load test

**Load test: Measure a local HTTP server under load** sends a number of
requests, a fixed number at a time, and reports requests per second, the
median, 95th and 99th percentile, a latency histogram, completions per second,
status codes and errors. **Copy report** gives the numbers as text.

Only addresses on this machine or a private network can be tested; anything
else is refused. A run is capped at 20,000 requests, 64 at a time.

## Markdown slides

**Slides: Present this Markdown file** shows the file in front as slides;
**Slides: New slide deck…** creates a sample.

- A line of three dashes with a blank line above it starts a new slide.
- Text after a line starting with `Note:` (or `???`) is a speaker note, shown
  only in the notes panel.
- Front matter at the top is skipped; its `title:` names the deck.

| Key | |
|---|---|
| `→` `↓` `Space` `Enter` / `←` `↑` `Backspace` | next / previous |
| `Home`, `End` | first, last |
| `O` | overview of all slides |
| `S` | notes and the next slide |
| `F` | full screen |
| `T` | restart the clock |

Long slides are scaled down to fit. **Edit slide** jumps to the slide's line in
the Markdown file.

## Import graph

**Import graph: What imports what in this workspace** reads the imports of
JavaScript, TypeScript and Python files (relative paths, the `@/` alias, Python
packages).

- **File** — what the selected file imports and what imports it, how many files
  depend on it in total, and the chain of imports from it to another file.
- **Cycles** — groups of files that import each other.
- **Not imported** — files nothing imports (entry points, tests and config
  files are left out).
- **Most imported** and **Packages**.

**Copy as DOT** gives the whole graph for Graphviz.

## Code image

Select code, then **Code image: Make a picture of the selected code**. Choose a
theme, a backdrop, the size, and whether to show line numbers, a window frame
and the file name. **Copy image** or **Save PNG** (into the workspace folder, at
twice the shown size).

## QR code

**QR code: Make a QR code** for text or a link, Wi-Fi details, a contact or an
e-mail. A selection in the editor becomes the text. Choose the error-correction
level (H survives the most damage — use it for print) and the colours, then copy
or save as SVG or PNG. One code holds up to 2,953 bytes at level L.

## Archive browser

**Archive: Look inside a zip file…** lists a zip — or a `.jar`, `.docx`,
`.xlsx`, `.epub`, `.vsix`, `.whl`, `.apk` — as a tree with sizes. Click a text
file to preview it; **Extract…** writes one entry, a folder or everything to a
folder you name. Entries whose names point outside that folder are skipped.
Password-protected entries and Zip64 archives are not supported.

## Translations

**Translations: Compare and edit translation files** finds JSON locale files in
folders such as `locales`, `i18n`, `lang` or `messages` — either
`locales/en.json`, `locales/fr.json` or `locales/en/common.json`,
`locales/fr/common.json` — and shows every key next to its text in each language.

| Marked | Means |
|---|---|
| red | the key is missing, or its text is empty |
| amber | same text as the base language (probably not translated) |
| violet | the placeholders (`{name}`, `{{count}}`, `%s`) differ from the base |

Click a text to edit it. **+ Key** adds a key to every file. Files are written
back with their own indentation and key order.

## Environment files

**Environment: Compare .env files side by side** lists every variable of the
`.env*` files in the workspace's top folder. Values are masked until you tick
**Show values** or reveal a single one.

- Red: missing from a file, or empty. Amber: the files disagree.
- `.env.example` and similar are treated as templates: their empty values are expected.
- Editing rewrites only that line; comments, order and `export` are kept.
- **+ File** creates a new file from the template; **+ Variable** adds a name to every file.

## Cron workbench

**Cron: Open the cron workbench** explains a five-field cron expression in
words, lists the next twelve run times (local time or UTC) and says what is
wrong when the expression does not parse. A selected expression in the editor is
taken over. It warns about schedules that are valid but surprising, such as
setting both day fields.

## Charts

**Chart: Plot this CSV / JSON file** draws a line, bar, scatter or histogram
chart from a `.csv`, `.tsv` or `.json` file (an array of objects, or an object
of arrays). The first chart is chosen from the columns: dates give a line chart,
categories a bar chart.

Bar charts group by a column and show the sum, mean, count, minimum or maximum.
Line and scatter charts can show several columns and a trend line with its r².
**Copy image** and **Save SVG** export the chart.
