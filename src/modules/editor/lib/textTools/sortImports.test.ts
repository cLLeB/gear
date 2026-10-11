import { describe, expect, it } from "vitest";
import { sortJsImports, sortPythonImports } from "./sortImports";

describe("sortJsImports", () => {
  it("groups, sorts, merges and sorts specifiers", () => {
    const src = [
      '"use client";',
      'import { z, a } from "./local";',
      'import React, { useState } from "react";',
      'import { readFile } from "node:fs/promises";',
      'import type { Foo } from "@/types";',
      'import { useEffect } from "react";',
      'import * as path from "path";',
      'import { Button } from "@/components/button";',
      "",
      "export const x = 1;",
    ].join("\n");
    expect(sortJsImports(src)).toBe(
      [
        '"use client";',
        'import { readFile } from "node:fs/promises";',
        'import * as path from "path";',
        "",
        'import React, { useEffect, useState } from "react";',
        "",
        'import { Button } from "@/components/button";',
        'import type { Foo } from "@/types";',
        "",
        'import { a, z } from "./local";',
        "",
        "export const x = 1;",
      ].join("\n"),
    );
  });

  it("keeps side-effect imports in place and handles multi-line specifiers", () => {
    const src = [
      'import "./polyfill";',
      'import {',
      "  b,",
      "  a,",
      '} from "lib";',
      'import "./styles.css";',
      'import z from "zed";',
      'import y from "why";',
      "code();",
    ].join("\n");
    expect(sortJsImports(src)).toBe(
      ['import "./polyfill";', 'import { a, b } from "lib";', 'import "./styles.css";', 'import y from "why";', 'import z from "zed";', "code();"].join("\n"),
    );
  });

  it("leaves files without leading imports untouched", () => {
    expect(sortJsImports("const a = 1;\nimport x from 'y';")).toBe("const a = 1;\nimport x from 'y';");
  });
});

describe("sortPythonImports", () => {
  it("groups stdlib, third-party and local, merging from-imports", () => {
    const src = [
      '"""Module docstring."""',
      "",
      "from .models import User",
      "import requests",
      "import os, sys",
      "from typing import List, Dict",
      "from __future__ import annotations",
      "from typing import Any",
      "import numpy as np",
      "",
      "def main(): pass",
    ].join("\n");
    expect(sortPythonImports(src)).toBe(
      [
        '"""Module docstring."""',
        "",
        "from __future__ import annotations",
        "",
        "import os",
        "import sys",
        "from typing import Any, Dict, List",
        "",
        "import numpy as np",
        "import requests",
        "",
        "from .models import User",
        "",
        "def main(): pass",
      ].join("\n"),
    );
  });

  it("joins parenthesised imports", () => {
    expect(sortPythonImports("from x import (\n    b,\n    a,\n)\nprint(1)")).toBe("from x import a, b\nprint(1)");
  });
});
