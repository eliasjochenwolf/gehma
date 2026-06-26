const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  const adminKey = process.env.ADMIN_KEY;
  const provided = event.queryStringParameters?.key || "";

  if (!adminKey || provided !== adminKey) {
    return { statusCode: 401, body: JSON.stringify({ error: "Nicht autorisiert" }) };
  }

  const store = getStore("events");
  const action = event.queryStringParameters?.action || "list";

  try {
    if (action === "list") {
      const pending = (await store.get("pending", { type: "json" })) || [];
      const approved = (await store.get("approved", { type: "json" })) || [];
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending, approvedCount: approved.length }),
      };
    }

    if (action === "approve") {
      const id = event.queryStringParameters?.id;
      const pending = (await store.get("pending", { type: "json" })) || [];
      const approved = (await store.get("approved", { type: "json" })) || [];
      const idx = pending.findIndex((e) => e.id === id);
      if (idx === -1) return { statusCode: 404, body: JSON.stringify({ error: "Nicht gefunden" }) };
      approved.push(pending[idx]);
      pending.splice(idx, 1);
      await store.setJSON("pending", pending);
      await store.setJSON("approved", approved);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === "reject") {
      const id = event.queryStringParameters?.id;
      const pending = (await store.get("pending", { type: "json" })) || [];
      const filtered = pending.filter((e) => e.id !== id);
      await store.setJSON("pending", filtered);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === "delete-approved") {
      const id = event.queryStringParameters?.id;
      const approved = (await store.get("approved", { type: "json" })) || [];
      const filtered = approved.filter((e) => e.id !== id);
      await store.setJSON("approved", filtered);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Unbekannte Aktion" }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
