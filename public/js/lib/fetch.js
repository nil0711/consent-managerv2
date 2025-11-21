export async function fetchJSON(url, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {})
  };
  const response = await fetch(url, {
    credentials: "same-origin",
    ...opts,
    headers
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("Non-JSON response");
  }
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || response.statusText);
  }
  return data;
}

if (typeof window !== "undefined") {
  window.fetchJSON = fetchJSON;
}
