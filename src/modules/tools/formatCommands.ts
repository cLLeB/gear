// Editor commands for the format converters: each replaces the selection
// (or the whole file) with the converted text.

import { parseJson5 } from "@/lib/lang/json5";
import type { CodeActionDescriptor } from "@/modules/editor/lib/codeActions";
import { replaceTarget } from "@/modules/editor/lib/textTools/commands";
import {
  csvToJson,
  envToJson,
  jsonToCsv,
  jsonToEnv,
  jsonToMarkdownTable,
  jsonToQuery,
  jsonToXml,
  parseToml,
  queryToJson,
  toToml,
  xmlToJson,
} from "./formats";

const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

const convert = (id: string, label: string, keywords: string[], fn: (text: string) => string): CodeActionDescriptor => ({
  id: `convert.${id}`,
  label: `Convert ${label}`,
  keywords: ["convert", "transform", ...keywords],
  run: (v) => replaceTarget(v, `Convert ${label}`, fn),
});

export const FORMAT_ACTIONS: CodeActionDescriptor[] = [
  convert("csvToJson", "CSV/TSV to JSON", ["csv", "tsv", "json", "spreadsheet"], (t) => pretty(csvToJson(t))),
  convert("jsonToCsv", "JSON to CSV", ["csv", "json", "excel", "export"], (t) => jsonToCsv(parseJson5(t))),
  convert("jsonToMdTable", "JSON array to Markdown table", ["markdown", "table", "json"], (t) => jsonToMarkdownTable(parseJson5(t))),
  convert("tomlToJson", "TOML to JSON", ["toml", "cargo", "pyproject", "json"], (t) => pretty(parseToml(t))),
  convert("jsonToToml", "JSON to TOML", ["toml", "json", "config"], (t) => toToml(parseJson5(t))),
  convert("xmlToJson", "XML to JSON", ["xml", "json", "soap", "rss"], (t) => pretty(xmlToJson(t))),
  convert("jsonToXml", "JSON to XML", ["xml", "json"], (t) => jsonToXml(parseJson5(t))),
  convert("envToJson", ".env to JSON", ["dotenv", "env", "json"], (t) => pretty(envToJson(t))),
  convert("jsonToEnv", "JSON to .env", ["dotenv", "env", "json", "environment"], (t) => jsonToEnv(parseJson5(t))),
  convert("queryToJson", "URL query string to JSON", ["query", "url", "params", "querystring"], (t) => pretty(queryToJson(t.trim()))),
  convert("jsonToQuery", "JSON to URL query string", ["query", "url", "params", "querystring"], (t) => jsonToQuery(parseJson5(t))),
];
