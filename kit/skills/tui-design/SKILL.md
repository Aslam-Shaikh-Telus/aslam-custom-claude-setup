---
name: tui-design
description: Use when building, reviewing or changing a terminal user interface or an interactive terminal program — menus, prompts, progress display, spinners, keybindings, panes, status bars, coloured or ANSI terminal output. Triggers on TUI, terminal UI, terminal app, curses, and on the libraries rich, Textual, prompt_toolkit, questionary, Bubble Tea, Lip Gloss, Bubbles, ratatui, crossterm, Ink, blessed, Spectre.Console, Terminal.Gui. Not for ordinary non-interactive scripts or CLI argument parsing.
---

# TUI design and development

Apply when the program draws to a terminal *and a human watches it happen*. A script that
prints log lines and exits is not a TUI — do not load these rules onto it.

## 1. Classify the mode first

Do this before applying any other rule. The two modes have genuinely different rulesets, and
applying full-screen rules to an inline flow is the most common way this goes wrong.

| | **Inline** | **Full-screen** |
|---|---|---|
| Examples | `rich` Console, prompt_toolkit, questionary, Spectre.Console, ora | Textual, Bubble Tea, ratatui, Terminal.Gui, curses, Ink |
| Owns the screen? | No — writes into scrollback, output survives exit | Yes — alt-screen, render loop, screen restored on exit |
| Cares about resize? | Barely — reflow on next print | Critically — must re-layout |
| Cares about diff-rendering? | No | Yes |

Rules below are tagged **[inline]**, **[full]**, or **[both]**. State which mode you concluded
and why before you start, so a wrong call is visible and correctable rather than silent.

## 2. Non-negotiables [both]

These are what make a TUI *broken* rather than merely ugly. Check every one on any change to
an interactive surface.

- **Every exit path restores the terminal.** Clean quit, `Ctrl-C`, unhandled exception,
  `SIGTERM`, and the error paths that return early. Wire it to `finally` / `atexit` /
  `defer` / a signal handler — never to the happy path alone. A program that leaves the
  terminal in raw mode or on the alt-screen after a crash is the worst failure mode in this
  category: the damage outlives the process and the user has to `reset`.
- **`Ctrl-C` and EOF exit cleanly, not with a traceback.** `KeyboardInterrupt` and `EOFError`
  are *normal user input* at a prompt, not faults. EOF happens whenever stdin is a pipe, a
  closed handle, or a CI runner — which is also how someone will first hit it. Catch both at
  the loop boundary and return a real exit code.
- **Degrade when stdout is not a TTY.** Check `isatty` and fall back to plain line output for
  pipes, redirects and CI logs. Libraries that "handle this automatically" handle *colour*
  automatically; they do not handle your interactive loop, which will spin or crash on EOF.
- **Honour `NO_COLOR`** (https://no-color.org) and `TERM=dumb`.
- **Never carry meaning in colour alone.** Pair with a glyph or a word. Red-means-failure is
  invisible to a colour-blind user, a monochrome terminal, and a captured log.
- **Diagnostics to stderr, data to stdout.** Someone will pipe the output. Meaningful exit
  codes — 0 success, non-zero distinguishable failures.
- **Confirm destructive and irreversible actions**, and make the confirmation name the target
  ("run against PROD 'x'"), not just ask "are you sure?".

## 3. Usability [both]

- **Fully keyboard-operable.** Mouse support is a bonus and never a requirement.
- **Use the conventions, don't invent keys.** `q` quit · `?` help · `/` search · `Esc` back one
  level · `Tab` next pane · `Ctrl-C` always exits. Users arrive with these already in their
  fingers from lazygit, k9s, htop, fzf, less. A novel keymap is a cost with no payoff.
- **`?` for help is the highest discoverability-per-line-of-code feature in a TUI.** Add it early.
- **Show what is valid right now** — a status/footer bar **[full]**, or a prompt that lists the
  options **[inline]**. Recognition over recall: never require a key you never displayed.
- **Anything over ~200ms gets progress and a way to cancel.** Silence reads as a hang. If you
  cannot show percentage, show activity and what it is doing.
- **Debounce filter and search input**; don't re-query per keystroke.
- **Errors say what failed, why, and what to do next.** A stack trace is not an error message.
  Keep the traceback behind a `--debug` flag.
- **Don't clear the screen on exit in inline mode.** The user wants the output they just waited for.

## 4. Rendering [full]

- **Handle resize** and re-layout. Test the 80x24 floor. Degrade by collapsing or hiding panes,
  never by letting the frame wrap — a wrapped frame is unreadable garbage.
- **Diff-render; don't repaint the whole screen each frame.** Full repaints flicker badly over
  SSH and on Windows conhost.
- **Never block the render loop.** I/O async or off-thread; the UI stays responsive while work runs.
- **Prefer the terminal's 16-colour palette** so the user's own theme applies. Reserve
  truecolor for things that genuinely need it.
- **Unicode with an ASCII fallback path** — box-drawing and powerline glyphs are not universal.

## 5. Architecture and testing [both]

- **Separate state from rendering** (model → update → view). Rendering that cannot be tested is
  almost always state-and-paint tangled together; splitting them is what makes the rest testable.
- **Test the rendered text buffer, not the live screen.** Write the expected frame first, per
  the test-first rule in CLAUDE.md:

  | Framework | Harness |
  |---|---|
  | `rich` | `Console(record=True)` + `export_text()`, or `capsys` |
  | Textual | `pytest-textual-snapshot`, `run_test()` pilot |
  | ratatui | `TestBackend` |
  | Bubble Tea | `teatest` |
  | Terminal.Gui | fake/headless driver |

- **Keep the input loop thin and inject the prompt functions** so tests drive it without a real
  terminal. Pure choice/format helpers get ordinary unit tests; the loop gets a smoke test.
- **Test the non-negotiables too** — they are where the real bugs live and they are easy to
  assert: injecting a prompt that raises `KeyboardInterrupt` or `EOFError` should produce a
  clean exit code, not an exception.

## 6. Windows [both]

Relevant on this machine specifically — most TUI guidance is written from a Linux terminal.

- **Force UTF-8 output.** PowerShell's default codepage mangles box-drawing and block glyphs.
- **`ENABLE_VIRTUAL_TERMINAL_PROCESSING`** must be on for ANSI under conhost.
- **Windows Terminal and conhost behave differently** — colour depth, glyph width, resize.
  Say which one you tested; don't claim both.

## Framework specifics

Read [references/frameworks.md](references/frameworks.md) once the framework is known — it
carries the idiomatic structure, the exit-safety idiom, the test harness and the characteristic
mistake for each. Don't guess these from memory.
