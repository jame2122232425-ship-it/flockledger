export class RequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const method = init?.method?.toUpperCase() ?? "GET";
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set("Content-Type", "application/json");
    if (!headers.has("Idempotency-Key") && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      headers.set("Idempotency-Key", crypto.randomUUID());
    }
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers,
    });
  } catch {
    throw new RequestError("Could not reach FlockLedger. Check your connection and try again.", 0);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new RequestError("The server returned an unreadable response.", response.status);
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      && typeof payload.error === "string"
      ? payload.error
      : "The request could not be completed.";
    throw new RequestError(message, response.status);
  }
  return payload as T;
}

