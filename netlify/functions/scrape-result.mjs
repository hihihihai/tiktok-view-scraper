import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const requestId = url.searchParams.get("requestId");

  if (!requestId) {
    return new Response(
      JSON.stringify({ status: "error", message: "Missing requestId" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const store = getStore("scrape-results");

  try {
    const result = await store.get(requestId, { type: "json" });

    if (!result) {
      return new Response(JSON.stringify({ status: "pending" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Clean up completed/error results after reading
    if (result.status === "complete" || result.status === "error") {
      // Delete after a short delay to avoid race conditions with retries
      store.delete(requestId).catch(() => {});
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ status: "pending" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/.netlify/functions/scrape-result",
};
