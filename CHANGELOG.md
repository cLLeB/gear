# Changelog

## [0.1.2](https://github.com/cLLeB/gear/compare/v0.1.1...v0.1.2) (2026-07-04)


### Features

* add built-in wallpaper gallery and background personalization ([757c345](https://github.com/cLLeB/gear/commit/757c345b66d92753da4d5ab1444cff10c9b22e7b))
* add Explain/Refactor/Fix quick-action presets to AI selection popup ([2b8c8fd](https://github.com/cLLeB/gear/commit/2b8c8fd86b082af48886540af279f7b83f7327d2))
* add ShortcutIds for pane close, zen mode, terminal clear, editor commands ([1b10182](https://github.com/cLLeB/gear/commit/1b10182c56cc0729130abf0a7aade7c1e1a99b93))
* add unsplit pane (Ctrl+Shift+W) and close-other-tabs context menu ([7935a43](https://github.com/cLLeB/gear/commit/7935a43683159ab0a148d937e4f6fb944ef8314a))
* add website link to About, i18n update dialog, remove stale Arch/winget artifacts ([281cb3d](https://github.com/cLLeB/gear/commit/281cb3d84a046ea4e7061a348f78e02922e8ae27))
* add word wrap toggle and rectangular selection to code editor ([ab3aa55](https://github.com/cLLeB/gear/commit/ab3aa55225a5846ce79eb9f9ffd368940c5032d7))
* **chronicle:** engine spine + capture commands ([80816c1](https://github.com/cLLeB/gear/commit/80816c1c782148918ab9203d3cda0a35270481a6))
* **chronicle:** git + agent capture, file history, sandbox checkout ([7a1a8db](https://github.com/cLLeB/gear/commit/7a1a8db445be870a3f905056f1d3adb3ec260a1a))
* **chronicle:** terminal command capture via OSC 133 ([d8160cc](https://github.com/cLLeB/gear/commit/d8160cc818157937e98b54db7d7d47c75f68e70e))
* **editor:** inline media preview (image/video/audio/PDF) ([04bb070](https://github.com/cLLeB/gear/commit/04bb0707599b1283af233cd4e24305bc4691439b))
* **editor:** markdown-rendered-default + per-tab language override ([aa673f3](https://github.com/cLLeB/gear/commit/aa673f3a24b9460e8483b6c80544aa908bd2754c))
* **editor:** Swift, Vue, Twig syntax + all Dockerfile variants ([a7dc2f9](https://github.com/cLLeB/gear/commit/a7dc2f95f971f3a01131c0f4fa2b6d11a9f20f20))
* **explorer:** accept files dropped from the OS ([3025e9c](https://github.com/cLLeB/gear/commit/3025e9c8a57ca345c9446901043d45fd713fe6d2))
* **fs:** fuzzy file search (subsequence, path-aware, smart-case) ([94a6bd6](https://github.com/cLLeB/gear/commit/94a6bd6167bbf73557a91edba786d2679690b833))
* **lsp:** adopt LSP subsystem (Rust language server host) ([242551f](https://github.com/cLLeB/gear/commit/242551f02f061ad0e5e020744a3eb312b8338459))
* **platform:** macOS entitlements + press-and-hold, editor zoom, Linux clipboard ([c9cbb57](https://github.com/cLLeB/gear/commit/c9cbb57790fd201dd1d19c1bec42e246226f3afd))
* port command palette, window title, SCM context menu, explorer active-file highlight ([b43ea2b](https://github.com/cLLeB/gear/commit/b43ea2b787130396ffb0d63e38df798b512b50ca))
* restore Arch option in Linux update dialog ([b179e75](https://github.com/cLLeB/gear/commit/b179e75fe87a51c02d2b865daae510b39058f735))
* **rewind:** agent capture, blame-across-time, sandbox checkout UI ([af9e6c1](https://github.com/cLLeB/gear/commit/af9e6c11f125dc6fc8b9d86fdd11aac263b069cb))
* **rewind:** diff stats in blame view + sandbox GC in retention ([8d6bf93](https://github.com/cLLeB/gear/commit/8d6bf93b3e940f72dbd47f4127a4f859d15fb202))
* **rewind:** open created sandbox in file explorer ([0e0bd9e](https://github.com/cLLeB/gear/commit/0e0bd9ef047325b05405f64450477f2fe31062d2))
* **rewind:** restore-all to promote a whole point-in-time to live ([b8e1c11](https://github.com/cLLeB/gear/commit/b8e1c110a32c15b32dd74687b2eb03a9c1cd2c95))
* **rewind:** timeline full-text search + retention pruning UI ([27ca8fd](https://github.com/cLLeB/gear/commit/27ca8fdf839ddd3343121e680de2601f0e5b17c3))
* **rewind:** timeline UI + file-capture wiring ([a770607](https://github.com/cLLeB/gear/commit/a770607500f4221abf7230a9c4cac5aa8f5d2635))
* settings pane refactor, AI mini window geometry, fs watching, and managed agents ([2d8695f](https://github.com/cLLeB/gear/commit/2d8695fd8167fa59805cacd9f304a5ad8aef5497))
* **settings:** add terminal cursor-blink toggle ([dfbe3f9](https://github.com/cLLeB/gear/commit/dfbe3f9f687f9bdf5e3dc645f36c1ebd86c5d559))
* **settings:** terminal font-weight picker ([44aa0f4](https://github.com/cLLeB/gear/commit/44aa0f431b19f9ab7531bbef47efec7319c42413))
* **spaces:** activate in-session spaces (switcher, filtering, move) ([2c3bfba](https://github.com/cLLeB/gear/commit/2c3bfba5c54936c7784a3d5d05747505b8646f05))
* **spaces:** persist spaces across restarts (additive, defensive) ([6b507e6](https://github.com/cLLeB/gear/commit/6b507e6b6298e20c72f0ce247d2ee91f1556a479))
* **spaces:** scaffold spaces module + tab/workspace/settings primitives ([6d8cfb1](https://github.com/cLLeB/gear/commit/6d8cfb14cb2dfa8a768ef75a5ff2b9ba2be65441))
* surface duplicate/move/delete/comment line shortcuts in dialog (already handled by CM defaultKeymap) ([2616f0c](https://github.com/cLLeB/gear/commit/2616f0c1eb0e2049e676e678786c6b040965b0b2))
* sync 14 upstream commits from terax-ai ([5308a3e](https://github.com/cLLeB/gear/commit/5308a3eb11627aa20666ddb90cc9d3693a01490d))
* **tabs:** make block-mode terminal reachable (dropdown + Cmd+Shift+T) ([3dbe56f](https://github.com/cLLeB/gear/commit/3dbe56f8e4a8b58aaa5339f967b986fdc41ab700))
* **terminal:** adopt upstream block-mode terminal + reliability, keep Gear branding ([18fe87e](https://github.com/cLLeB/gear/commit/18fe87ed833cc65a5d7105606adcd437cdffe5b4))
* **terminal:** port file-drop, close-confirm, and tab-rename from terax-ai ([eb7e950](https://github.com/cLLeB/gear/commit/eb7e950536880887a353bf901a4e7f215920363a))
* **terminal:** restore pane-level rename on split panes ([404885e](https://github.com/cLLeB/gear/commit/404885ee56990adbbe4c6bf16f5f8620691ca62e))
* **terminal:** unified Shell/AI input bar, block shell picker, and command history ([97e7266](https://github.com/cLLeB/gear/commit/97e726694bf8230f506a0d65649629660056261e))
* **theme:** live theme preview on hover ([253e1b6](https://github.com/cLLeB/gear/commit/253e1b6322f687cbc06f1b1172be1f86559e3f79))
* **window:** confirm quit while a terminal process is running ([eeefa9f](https://github.com/cLLeB/gear/commit/eeefa9f2dcd0797a96bde7bedeecba6c419a5a9d))
* zen mode, sidebar position toggle, terminal clear shortcut ([532bfa0](https://github.com/cLLeB/gear/commit/532bfa0d4f3902ef3179bb73b0b678ad5c4b4829))


### Bug Fixes

* correct AUR package name to gear-terminal-bin ([0724138](https://github.com/cLLeB/gear/commit/07241383c0811520fe9a8ed1a65eb63396e8083d))
* **linux:** strip AppImage env from spawned shells ([8f37c7f](https://github.com/cLLeB/gear/commit/8f37c7f5e3ce47dda6af92875e369b6714596ff2))
* **lsp:** age-guard idle eviction against concurrent multi-root opens ([4ffa69b](https://github.com/cLLeB/gear/commit/4ffa69be326734a4b3a74a8a93fcb81184979967))
* **media:** allow http://asset.localhost in CSP so images load on Windows ([21bc405](https://github.com/cLLeB/gear/commit/21bc405cfc978d7a7faf13f1375e51d5672fbdbe))
* **media:** limit preview to formats WebView2 can decode ([77beadf](https://github.com/cLLeB/gear/commit/77beadff8f4f717f33dcb959c3958fe4b70782b5))
* preserve left terminal content when splitting panes ([7d29a81](https://github.com/cLLeB/gear/commit/7d29a81001bf06ad2fc21f02ed7eb2a1357885be))
* **pty:** reap session on child exit to free stranded pseudoconsole ([b0b03a0](https://github.com/cLLeB/gear/commit/b0b03a0e4245410cdd0d92da1266b0eb5ebce9cc))
* **pty:** reply to pwsh startup cursor query so new tabs don't hang blank ([fba6d1d](https://github.com/cLLeB/gear/commit/fba6d1dd40d58d69b00f81b287182b8fd554f127))
* replace minimal-1 wallpaper with cleaner minimal interior shot ([c117f64](https://github.com/cLLeB/gear/commit/c117f64aa5342a37077a6737e2e2c844b5b75eab))
* **settings:** register new prefs in the change-listener key map ([cd38fae](https://github.com/cLLeB/gear/commit/cd38faeb6040cc7cd546357d594ad94fbbb0643d))
* **spaces/editor:** tabs open in active space; more media types; drag across spaces ([bd4675f](https://github.com/cLLeB/gear/commit/bd4675feffcd32e735adf80734b35ba1fbb97685))
* terminal layout, OSC re-registration, and configurable split focus ([3410ddd](https://github.com/cLLeB/gear/commit/3410ddd5175b19688d7f352826cccda42870be94))
* **terminal:** honor per-tab shell picker; add pane close button ([be07342](https://github.com/cLLeB/gear/commit/be073429fdb76be3d28b37cc9f0f88d413378724))
* **terminal:** make cursor-blink toggle take visible effect ([6479352](https://github.com/cLLeB/gear/commit/6479352fc2d3652a4e5995f74e191ccb07a68130))
* **terminal:** permanently fix blank/unresponsive terminal on open ([84efc92](https://github.com/cLLeB/gear/commit/84efc926e9b236300b68096ca8e6ec0de7298aa9))
* **window:** close via titlebar X and Alt+F4 ([9f0ce26](https://github.com/cLLeB/gear/commit/9f0ce26ee2a196f94711acc7c2d717524da92f02))

## [0.1.1](https://github.com/cLLeB/gear/compare/v0.1.0...v0.1.1) (2026-05-25)


### Features

* agent notification center, OSC detection, and Gear branding ([56bf712](https://github.com/cLLeB/gear/commit/56bf7121927549c5d99f3271623b325243f41b23))

## [0.1.2](https://github.com/cLLeB/gear/compare/v0.1.1...v0.1.2) (2026-05-25)


### Features

* agent notification center, OSC detection, and Gear branding ([56bf712](https://github.com/cLLeB/gear/commit/56bf7121927549c5d99f3271623b325243f41b23))

## [0.1.1](https://github.com/cLLeB/gear/compare/Gear-v0.1.0...Gear-v0.1.1) (2026-05-25)


### Features

* agent notification center, OSC detection, and Gear branding ([56bf712](https://github.com/cLLeB/gear/commit/56bf7121927549c5d99f3271623b325243f41b23))
