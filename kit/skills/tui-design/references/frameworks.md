# Framework specifics

Load the section for the framework in play. Each entry gives the idiomatic structure, the
exit-safety idiom (the thing most often missing), the test harness, and the characteristic
mistake. Verify API details against the installed version before relying on them — these move.

---

## `rich` (Python) — **inline**

**It is a rendering library, not a TUI framework.** It styles what you print; the interactive
loop, the state machine and the exit handling are all yours. This is the single most common
misunderstanding, and it is why `rich` programs so often lack the exit safety a real framework
would have given them for free.

- Structure: keep pure `map_*` / `render_*` helpers separate from the loop; pass `Console` and
  the prompt callables in as parameters so tests can inject them.
- Handles for you: colour degradation, `NO_COLOR`, `TERM=dumb`, non-TTY detection for *styling*
  (`console.is_terminal`), width detection.
- Does **not** handle for you: `KeyboardInterrupt`, `EOFError`, your loop, your exit codes.
- Exit safety: wrap the input loop and catch `(KeyboardInterrupt, EOFError)` at the boundary,
  return a real exit code. `rich.progress.Progress` and `Live` are context managers — use
  `with`, so an exception still tears down the live region.
- Testing: `Console(record=True)` then `export_text()` to assert on the frame; or `capsys`.
  Inject a `prompt_choice` that raises to test the exit paths.
- Characteristic mistake: `Live`/`Progress` started without a context manager, leaving a
  half-drawn live region on the screen after an error.

## Textual (Python) — **full-screen**

- Structure: `App` subclass, `compose()` yields widgets, `BINDINGS` declares the keymap
  (put `?` and `q` in it), reactive attributes drive re-render.
- Handles for you: alt-screen enter/exit, terminal restore, resize, mouse, focus, diff-rendering.
- Exit safety: mostly free — but anything you open yourself (files, sessions, subprocesses)
  still needs `on_unmount` or a context manager.
- Testing: `pytest-textual-snapshot` for frame snapshots; `async with app.run_test() as pilot`
  to drive keys and assert on state.
- Characteristic mistake: blocking the event loop with synchronous I/O. Long work goes in a
  `@work` worker or an async task, or the whole UI freezes.

## prompt_toolkit / questionary (Python) — **inline**

- `PromptSession` gives history, completion and multiline for free.
- Exit safety: `prompt()` raises `KeyboardInterrupt` on Ctrl-C and `EOFError` on Ctrl-D — catch
  both explicitly; they are the documented control flow, not errors.
- Use `patch_stdout()` when background threads print, or their output corrupts the prompt line.
- Characteristic mistake: catching bare `Exception`, which misses `KeyboardInterrupt` entirely
  (it derives from `BaseException`).

## Bubble Tea + Lip Gloss + Bubbles (Go) — **full-screen**

- Structure: the Elm loop — `Init() Cmd`, `Update(Msg) (Model, Cmd)`, `View() string`. Lip Gloss
  styles the string `View` returns; Bubbles supplies ready-made list/table/spinner/textinput.
- Exit safety: `tea.NewProgram(m, tea.WithAltScreen())`; check the error from `Run()`. Bubble Tea
  recovers from panics and restores the terminal, but only for panics inside its own loop — a
  panic in a goroutine you spawned bypasses it.
- Testing: `teatest` drives a program and asserts on final output/model.
- Characteristic mistake: doing I/O directly inside `Update`. Return a `tea.Cmd` instead —
  `Update` must stay fast and pure or the UI stutters.

## ratatui + crossterm (Rust) — **full-screen**

- Structure: immediate-mode. You own the loop: read events, mutate state, call
  `terminal.draw(|f| ...)` and re-render widgets from scratch each frame.
- Exit safety — **this is the classic ratatui bug**: `enable_raw_mode()` + `EnterAlternateScreen`
  must be paired with `disable_raw_mode()` + `LeaveAlternateScreen` on *every* path, including
  panic. Install a panic hook (`std::panic::set_hook`) that restores the terminal first, or the
  user gets a wrecked shell and an invisible panic message. Recent ratatui ships
  `ratatui::init()` / `ratatui::restore()` helpers that set this up — check the version.
- Testing: `TestBackend` renders into an in-memory buffer you can assert on.
- Characteristic mistake: restoring only in the happy path, so any `unwrap()` on an error
  destroys the terminal.

## Ink (TypeScript/JS) — **full-screen-ish**

- React for the terminal: components, hooks, Flexbox layout via Yoga.
- `useInput` for keys, `useApp().exit()` to quit cleanly.
- Testing: `ink-testing-library` — render and assert on `lastFrame()`.
- Characteristic mistake: re-render storms from unmemoised props; the terminal is a far slower
  paint target than the DOM.

## .NET — **both, pick deliberately**

- **Spectre.Console** = inline. `AnsiConsole` markup, `Prompt`, `Progress`, `Status`. The
  analogue of `rich`: styling and prompts, not a screen manager.
- **Terminal.Gui** = full-screen. `Application.Init()` / `Application.Run()` /
  `Application.Shutdown()` — `Shutdown()` must be in a `finally`, or the console stays broken.
- Testing: Terminal.Gui exposes a fake driver for headless assertions.

---

## Sources

- **CLI UX principles** — Command Line Interface Guidelines: https://clig.dev
- **`NO_COLOR`** — https://no-color.org
- Textual: https://textual.textualize.io · rich: https://rich.readthedocs.io
- Bubble Tea: https://github.com/charmbracelet/bubbletea · Lip Gloss: https://github.com/charmbracelet/lipgloss
- ratatui: https://ratatui.rs · Ink: https://github.com/vadimdemedes/ink

There is no canonical terminal-specific accessibility standard. WCAG contrast ratios apply
qualitatively to 16/256-colour palettes, and Nielsen Norman heuristics map cleanly onto TUIs
(visibility of system status → the footer bar; recognition over recall → discoverable keys;
error prevention → confirmation prompts). Treat this as the acknowledged gap it is rather than
citing a standard that does not exist.

## Exemplars worth reading for pattern

`lazygit` (dense panes, contextual keys) · `k9s` (navigation, resource drill-down) ·
`btop` (dense data, colour discipline) · `fzf` (one job, instant feedback) ·
`helix` (modal keymap, which-key discoverability) · `yazi` (Miller columns) ·
`atuin` (search-first). When unsure what a pattern should feel like, look at how these do it
before inventing something.
