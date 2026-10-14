# Contributing to Circuit Craft

Thanks for helping. This guide covers how the code is organized, how to name branches and commits, and what a pull request needs.

## Setup

```bash
npm install
npm run dev        # local server with hot reload
npm run build      # must pass before opening a pull request
```

## Architecture

The code is split into layers. Each layer may only import from the layers listed below it.

| Layer | Folder | Contains | May import |
|---|---|---|---|
| Presentation | `src/presentation` | three.js board, SVG schematic, sheet, panels, DOM | everything below |
| Application | `src/application` | shared store, editor, multimeter, sheet sync | domain |
| Infrastructure | `src/infrastructure` | storage, clipboard, translations | domain |
| Domain | `src/domain` | circuit model, simulator, expression language | nothing outside `domain` |

Rules that keep it clean:

- **The domain never touches the DOM, three.js or translations.** Errors are thrown as `DomainError(code, args)` and translated in the presentation layer.
- **Every edit goes through `CircuitStore.commit()`.** That keeps the board, schematic, sheet and simulator in sync and makes the edit undoable.
- **Views do not talk to each other.** They listen to the store and the editor.
- **Board and schematic share the `Editor`.** A new tool goes in `application/editor.ts` once and works in both views.

### Adding a part

1. `domain/components.ts`: add the type, defaults, terminals and footprint.
2. `domain/simulation/topology.ts` and `simulator.ts`: describe how it behaves electrically.
3. `presentation/board/parts.ts`: 3D model. `presentation/schematic/symbols.ts`: symbol.
4. `presentation/describe.ts`: what the calculations panel shows.
5. Add its strings to **all five** locale files.

### Adding or changing text

All user-facing text lives in `src/infrastructure/i18n/locales/` (`en`, `es`, `pt`, `de`, `ja`). Add every new key to all five files; English is the fallback. Never hard-code text in a component.

## Branches

`main` is always deployable; Vercel publishes it. Do not commit to it directly: open a pull request.

Name branches as `type/short-description`, in lowercase with hyphens:

| Prefix | Use for | Example |
|---|---|---|
| `feat/` | New functionality | `feat/bjt-transistor` |
| `fix/` | Bug fixes | `fix/led-current-sign` |
| `refactor/` | Code changes with no behavior change | `refactor/split-board-view` |
| `perf/` | Performance | `perf/sparse-solver` |
| `i18n/` | Translations | `i18n/french` |
| `docs/` | Documentation only | `docs/architecture-diagram` |
| `chore/` | Tooling, dependencies, config | `chore/update-vite` |

Keep each branch focused on one change, and rebase on `main` before opening the pull request.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short summary in the imperative

Optional body explaining what and why.
```

- `type` matches the branch prefixes above (`feat`, `fix`, `refactor`, `perf`, `i18n`, `docs`, `chore`), plus `test` and `style`.
- `scope` is the area touched: `simulator`, `board`, `schematic`, `sheet`, `editor`, `ui`, `i18n`.
- Examples: `feat(simulator): add BJT model`, `fix(schematic): keep selection after undo`.

## Pull requests

Before opening one:

- [ ] `npm run build` passes (type check and build).
- [ ] The change works in the board **and** the schematic if it affects editing.
- [ ] New text exists in all five languages.
- [ ] Screenshots are attached for visual changes, in light and dark mode.

Describe what changed, why, and how you tested it. One approval is needed to merge, and squash merging keeps `main` readable.

## Reporting bugs

Open an issue with the steps to reproduce, what you expected, what happened, and your browser. Exporting the circuit from **⋯ → Circuit as JSON** and pasting it in the issue helps a lot.

## License

By contributing you agree that your contributions are released under the [MIT License](LICENSE).
