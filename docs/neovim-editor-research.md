# Embedded Neovim Editor Research

## Executive Summary

**Verdict:** Not directly feasible with current architecture. Glint is a pure web server; `neovim-component` requires Electron/NW.js to spawn a local Neovim process.

---

## neovim-component Analysis

**Repository:** <https://github.com/rhysd/neovim-component>

### How It Works

1. **Requires Node.js runtime** — Specifically designed for Electron or NW.js
2. **Spawns real nvim process** — Communicates via msgpack-rpc over stdio
3. **Canvas-based rendering** — Uses `<canvas>` to draw the terminal UI
4. **Polymer v2 WebComponent** — HTML custom element `<neovim-editor>`

### Architecture

```
Browser (Electron)
    └── <neovim-editor> WebComponent
            ├── editor.screen (canvas view)
            ├── editor.process (nvim subprocess)
            └── editor.store (flux state)
                    │
                    ▼
              nvim process (local)
```

### Key Limitation

> "This component assumes to be used in Node.js environment. (i.e. Electron)"

The component **cannot run in a standard browser** because:

- It needs `child_process.spawn()` to start nvim
- It uses msgpack-rpc which requires direct process communication
- There's no HTTP/WebSocket abstraction layer

---

## Pros of Embedded Neovim

| Pro | Description |
|-----|-------------|
| **Full Vim experience** | Complete nvim with plugins, macros, registers, etc. |
| **User's config** | Can use `~/.config/nvim/init.lua` |
| **No emulation gaps** | No missing Vim features (vs. CodeMirror vim mode) |
| **Plugin ecosystem** | Access to LSP, Treesitter, Telescope, etc. |

## Cons / Blockers

| Con | Description |
|-----|-------------|
| **Electron required** | Glint is a web server, not an Electron app |
| **User must have nvim** | Dependency on local nvim installation |
| **Outdated project** | Last commit 2020, uses Polymer v2 (deprecated) |
| **Complexity** | Process management, error handling, cleanup |
| **Security** | Spawning arbitrary processes from web context |

---

## Modern Alternatives (2024)

The `neovim-component` project is outdated (last updated 2017). Here are actively maintained alternatives:

### For Electron/Desktop Integration

| Project | Stack | Status | Notes |
|---------|-------|--------|-------|
| **[Neovide](https://neovide.dev)** | Rust + Skia | ✅ Active | Best standalone GUI, smooth animations |
| **[VV](https://github.com/vv-vim/vv)** | Electron | ✅ Active | Electron-based, modern UI |
| **[VimR](https://github.com/qvacua/vimr)** | Swift + AppKit | ✅ Active | macOS-only, exposes **NvimView** framework |
| **[Goneovim](https://github.com/akiyosi/goneovim)** | Go + Qt | ✅ Active | Feature-rich, cross-platform |
| **[Uivonim](https://github.com/smolck/uivonim)** | Electron | ⚠️ Sporadic | Fork of Veonim, web extensions |
| **[FVim](https://github.com/yatli/fvim)** | F# + Avalonia | ✅ Active | Cross-platform, GPU rendering |

> **Note:** VimR's [NvimView](https://github.com/qvacua/vimr/tree/master/NvimView) is a reusable Swift framework for embedding Neovim. Could be integrated into a macOS-only Electron/Tauri app via native modules.

### For Browser Integration

| Project | Stack | Status | Notes |
|---------|-------|--------|-------|
| **[Firenvim](https://github.com/glacambre/firenvim)** | Browser Ext | ✅ Active | Embeds nvim in browser textareas |

### Key Insight for Glint

If pursuing Electron, the best path is:

1. **Use Neovide's approach** — Connect to nvim via its RPC API
2. **Leverage [nvim-rs](https://github.com/KillTheMule/nvim-rs)** or **[node-client](https://github.com/neovim/node-client)** for the bridge
3. **Render using canvas/WebGL** like Neovide does

VV or Uivonim could serve as reference implementations for Electron-specific patterns.

---

## What Would Be Required

### Option A: Convert Glint to Electron App

**Effort:** Very High

1. Rewrite Glint as Electron app instead of web server
2. Bundle neovim-component (or fork and modernize it)
3. Handle nvim process lifecycle
4. Lose "serve markdown over HTTP" simplicity

**Tradeoffs:** Fundamentally changes Glint's nature from a collaborative web server to a desktop app.

### Option B: Server-Side Neovim over WebSocket

**Effort:** High

1. Run nvim on the server with `--headless` mode
2. Bridge nvim's msgpack-rpc API over WebSocket to browser
3. Create browser-side terminal renderer (xterm.js or custom canvas)
4. Handle multi-user sessions, security, resource limits

**Example architecture:**

```
Browser                     Server
   │                           │
   ├── WebSocket ──────────────┤
   │                           │
xterm.js/canvas  ◄───────►  nvim --headless
                              │
                         msgpack-rpc
```

**Existing projects:**

- `nvim.ws` — Experimental, unmaintained
- `firenvim` — Embeds nvim in browser textareas (requires browser extension + local nvim)

### Option C: Vim WASM

**Effort:** Medium

Projects like [pico-vim](https://nicholasbeadle.com/posts/wasm-vim-part-1/) compile Vim to WebAssembly. However:

- Very experimental
- Missing many nvim features
- No plugin support
- Limited practicality

---

## Recommendation

**Short-term:** Keep CodeMirror with vim mode. The current implementation covers 90% of use cases and is well-integrated.

**If pursuing Neovim:**

1. **Option B (WebSocket bridge)** is most compatible with Glint's architecture
2. Would require significant server-side work
3. Consider as a v4+ feature, not v3

---

## Alternative Improvements to Current Editor

Instead of full Neovim, consider enhancing CodeMirror:

| Feature | How |
|---------|-----|
| More Vim commands | Extend `@replit/codemirror-vim` |
| Visual mode fixes | Contribute to upstream |
| Custom Ex commands | Already done (`:w`, `:q`, `:wq`) |
| Registers | Partially supported in vim mode |

---

## References

- [neovim-component](https://github.com/rhysd/neovim-component) — Electron-based WebComponent
- [firenvim](https://github.com/glacambre/firenvim) — Browser extension + local nvim
- [@replit/codemirror-vim](https://github.com/replit/codemirror-vim) — Current solution
- [xterm.js](https://xtermjs.org/) — Terminal emulator for browser
