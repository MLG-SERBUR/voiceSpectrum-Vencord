/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 MLG-SERBUR and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// FORK: diagnostic log file writer. The upstream plugin has no native
// side; this file exists only so the desktop diagnostic can be written
// to a file the user can send, instead of copied out of DevTools by
// hand. Runs in the main process, so it can use Node's fs and Electron's
// app paths. Remove with the rest of the diagnostic logging once the
// desktop audio path is known.

import { app, IpcMainInvokeEvent } from "electron";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";

/**
 * Writes the collected diagnostic text to
 * %APPDATA%\Vencord\voiceSpectrum-diag.log on Discord desktop
 * (app.getPath("userData") is %APPDATA%\Discord there, so ".." is
 * %APPDATA%\Vencord, where Vencord's settings already live).
 * Returns the full path written, so the renderer can show it in a toast.
 * Overwrites the file each time with the full collected text, so the
 * file always matches the current session's diagnostics.
 */
export async function writeDiagLog(_e: IpcMainInvokeEvent, text: string): Promise<string> {
    const filePath = join(app.getPath("userData"), "..", "Vencord", "voiceSpectrum-diag.log");
    await mkdir(dirname(filePath), { recursive: true });
    const header = `VoiceSpectrum diag log — ${new Date().toISOString()}\n`;
    await writeFile(filePath, header + text, "utf-8");
    return filePath;
}
