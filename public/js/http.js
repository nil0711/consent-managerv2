(() => {
  async function readBody(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return text || null;
    }
  }

  async function jget(url, options = {}) {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      ...options
    });
    if (!response.ok) {
      const payload = await readBody(response);
      const error = payload?.error || response.statusText || "Request failed";
      throw new Error(typeof error === "string" ? error : "Request failed");
    }
    return response.json();
  }

  async function jpost(url, body, options = {}) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: JSON.stringify(body || {}),
      ...options
    });
    if (!response.ok) {
      const payload = await readBody(response);
      const error = payload?.error || response.statusText || "Request failed";
      throw new Error(typeof error === "string" ? error : "Request failed");
    }
    return response.json();
  }

  window.CMHttp = { jget, jpost };
})();
