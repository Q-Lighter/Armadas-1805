# Project rules

Read this file at the start of every prompt, then follow it for the whole session.

## Code layout

- The game rules live in `shared/` as plain TypeScript. The client and server are thin layers around them.

## Authority

- The server runs the real game world. The client only displays it and sends orders. The client must never be trusted with hidden information.

## Style

- Every screen uses the single shared style sheet `client/paper.css`, described in `docs/STYLE.md`. Never add a second theme.

## Numbers

- Every tuning number goes in `shared/settings.ts`. Never hard-code a number that a designer might want to change.

## Cost

- Everything must be free to run with no credit card.

## Devices

- The game must run in a browser on a phone, a Chromebook and a PC, and resize without looking broken.

## Ways of working

- Each prompt is one job and must finish inside one session. At the end of every prompt: test what you built, commit, push to `main`, and report back.
- Write short, clear code with comments in plain English.
- The debug view (TEMP-DEBUG) is temporary and must be removed before the fog of war and before online play.
