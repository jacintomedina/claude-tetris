# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla JS Tetris on HTML5 Canvas. No dependencies, no build, no tests, no linter. README and UI text are in Spanish; keep UI strings Spanish.

## Run

Open `index.html` directly, or serve locally (e.g. `python3 -m http.server`) and open the URL.

## Architecture

Three files: `index.html` (canvas `#board` 300x600, `#next-canvas` 120x120, HUD spans, `#overlay`), `style.css`, `game.js`.

`game.js` is one script with global mutable state (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, ...) declared on line 43 and reset in `init()`. Flow:

- `loop(ts)` via `requestAnimationFrame`: accumulates `dropAccum`, gravity step every `dropInterval`, then `draw()`. Pause/game over stop it with `cancelAnimationFrame(animId)`; `togglePause` and `init` restart it.
- Piece lifecycle: `lockPiece()` = `merge()` → `clearLines()` → `spawn()`. `spawn()` promotes `next`, makes new one, calls `endGame()` if spawn collides.
- `board` is `ROWS x COLS` of ints. `0` empty, `1-7` piece type index. Same index selects `COLORS[]` and `PIECES[]` (both index 0 = null).
- `collide(shape, ox, oy)` is the single collision check; `ny < 0` cells allowed (above board). Used by movement, rotation (`tryRotate` tries kicks `[0,-1,1,-2,2]` horizontally), ghost, and gravity.
- Scoring in `clearLines()`: `LINE_SCORES[cleared] * level`; level = `floor(lines/10)+1`; `dropInterval = max(100, 1000 - (level-1)*90)`. Soft drop +1/cell, hard drop +2/cell.
- Input: single `keydown` listener at bottom (Arrows, X rotate, Space hard drop, P/Escape pause menu; game keys ignored while paused).
