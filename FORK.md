# Fork

Upstream: https://git.c30.life/ced/voiceSpectrum-Vencord
(also mirrored here: https://github.com/MLG-SERBUR/voiceSpectrum-Vencord)
Upstream author: systemd, single commit `6096a89` (2026-10-12).

## Why forked

Upstream draws an audio visualizer behind speaking users in the voice
channel list, by attaching an `AnalyserNode` to Discord's web voice
engine (per-user outputs with `streamSourceNode`, plus the local input
`MediaStream`). Its README says it works on Discord web and Vesktop
only, not the official desktop client, which uses a native C++ voice
engine built on the WebRTC native library instead of the browser's
WebRTC. On desktop, `getAnalyser` returns null, so the canvas draws
nothing. Confirmed on desktop 2026-11-10: plugin loads and enables,
no visualizer appears while users speak.

Goal of this fork: make it work on Discord desktop, if possible.

## Changes, marked `// FORK` in the code

- Diagnostic logging in `getAnalyser` (`index.tsx`): logs the default
  voice connection shape once (keys, context, audioContext, output
  ids and their keys / streamSourceNode / mute, input stream tracks),
  the `IS_DISCORD_DESKTOP` / `IS_VESKTOP` / `IS_WEB` flags, and the
  keys of the `discord_voice` native module if reachable via
  `DiscordNative.nativeModules.requireModule("discord_voice")`. Also
  logs once per user when no analyser can be made for them, and why.
  This is temporary: remove once the desktop audio path is known.
- Diagnostic log file (`native.ts` + the `Write diag log now` button
  in plugin settings): every diagnostic line is also written to a
  file, so the user can send the file instead of copying DevTools
  console output. The native side (main process) writes to
  `%APPDATA%\Vencord\voiceSpectrum-diag.log` on Discord desktop
  (same folder as Vencord's settings), overwriting with the full
  collected lines each time. Lines are written automatically when
  they are logged (join a voice channel, get someone speaking), and
  the settings button forces a fresh snapshot and writes it, showing
  the path in a toast. Native access is lazy and guarded, so the
  plugin still works on web where `VencordNative` does not exist —
  there the button toasts that no native helper is available and no
  file is written.

## What is known so far

- Discord desktop audio goes through the native `discord_voice`
  module, not through browser WebRTC `MediaStream`s, so there is no
  per-user `MediaStream` / `streamSourceNode` to analyse in the
  renderer. That is the upstream limitation, not a build or patch
  failure: the plugin's voice-row patch applies and the canvas mounts,
  it just gets no audio data.
- No Vencord plugin reads per-user audio levels on desktop; the
  `VolumeBooster` plugin's `streamSourceNode` patch is explicitly
  web/Vesktop only (`predicate: () => !IS_DISCORD_DESKTOP`).
- Possible paths, unproven, to be chosen from the diagnostic logs:
  1. The desktop connection object exposes something analysable
     after all (different shape, e.g. a stream under another key).
  2. The `discord_voice` native module exposes per-user audio or
     level data that a plugin native side (`native.ts`, main process)
     can read and feed to the renderer.
  3. No per-user audio is reachable from the client at all, in which
     case a real spectrum on desktop is not possible from a plugin,
     and the fallback would be a mixed-output analyser (same spectrum
     for every speaking user) or speaking-state-driven animation —
     neither is a real per-user spectrum, so neither would be shipped
     silently as if it were.

## Attribution

Original plugin by systemd, under its LICENSE (GPL-3.0-or-later, see
LICENSE). This fork keeps the original copyright and license, and
records its own changes here and with `// FORK` comments.
