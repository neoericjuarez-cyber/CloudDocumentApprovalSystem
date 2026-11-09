// Thin wrapper around fetch for talking to the backend. Every API call goes through api().

const BASE_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
const TOKEN_KEY = "clouddocs.token";

// Browser storage can throw (private mode, blocked cookies), so never let it break the app.
export const tokenStore = {
  get(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token: string) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  },
  clear() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string[]>) {
    super(message);
  }
}

/** A message that is safe to show the user, whatever went wrong. */
export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : "Something went wrong. Please try again.";

// AuthProvider registers this so any API call that comes back 401 signs the user out.
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

/** Fetches a file (e.g. a PDF) with the same sign-in and error handling as api(). */
export async function apiBlob(path: string): Promise<Blob> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(BASE_URL + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check that the API is running.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401) { tokenStore.clear(); onUnauthorized(); }
    throw new ApiError(res.status, data?.error ?? "Something went wrong");
  }
  return res.blob();
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(BASE_URL + path, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check that the API is running.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // A 401 on /auth/login just means wrong credentials; anywhere else it means the session ended.
    if (res.status === 401 && path !== "/auth/login") {
      tokenStore.clear();
      onUnauthorized();
    }
    // When the server says exactly what is wrong ("Reason is required"), show that instead of "Validation failed".
    const detail = data?.details ? (Object.values(data.details).flat()[0] as string | undefined) : undefined;
    throw new ApiError(res.status, detail ?? data?.error ?? "Something went wrong", data?.details);
  }
  return data as T;
}
