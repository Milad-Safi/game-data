import { fetchJson } from "@/lib/fetchJson";

// Cancellation is an expected outcome when comparison controls change.
// Keep it out of the rejected-promise path without hiding real request errors.
export async function fetchCompareJson<T>(
  url: string,
  options: Parameters<typeof fetchJson>[1] & { signal: AbortSignal }
): Promise<T | null> {
  if (options.signal.aborted) return null;

  try {
    const data = await fetchJson<T>(url, options);
    return options.signal.aborted ? null : data;
  } catch (error) {
    if (
      options.signal.aborted ||
      (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
    ) return null;
    throw error;
  }
}
