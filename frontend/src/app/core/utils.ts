/** Small shared helpers for the editor UI. */

/** Generate an RFC 4122 v4 uuid (used for new routes/responses/rules). */
export function newUuid(): string {
  return crypto.randomUUID();
}

/** Download a JSON string as a file (import/export round-trip, DESIGN §2.13). */
export function downloadJson(fileName: string, jsonText: string): void {
  const fileBlob = new Blob([jsonText], { type: 'application/json' });
  const fileUrl = URL.createObjectURL(fileBlob);
  const downloadLink = document.createElement('a');
  downloadLink.href = fileUrl;
  downloadLink.download = fileName;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  URL.revokeObjectURL(fileUrl);
}

/** Read a File chosen in an <input type="file"> as utf-8 text. */
export function readFileAsText(selectedFile: File): Promise<string> {
  return new Promise<string>((resolveRead, rejectRead) => {
    const fileReader = new FileReader();
    fileReader.onload = () => resolveRead(String(fileReader.result ?? ''));
    fileReader.onerror = () => rejectRead(fileReader.error ?? new Error('Could not read file'));
    fileReader.readAsText(selectedFile);
  });
}

/** Format a millisecond timestamp as a short local time for the log viewer. */
export function formatLogTime(timestampMs: number): string {
  const logDate = new Date(timestampMs);
  return logDate.toLocaleTimeString([], { hour12: false });
}

/** Relative "2 s ago" style label for the log viewer. */
export function elapsedSince(timestampMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - timestampMs);
  if (elapsedMs < 1000) return `${Math.round(elapsedMs)} ms`;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds < 60) return `${elapsedSeconds} s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} m ago`;
  return `${Math.floor(elapsedMinutes / 60)} h ago`;
}
