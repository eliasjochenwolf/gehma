const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async function (event) {
  connectLambda(event);
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const required = ["title", "cat", "isoDate", "city"];
  for (const f of required) {
    if (!data[f] || String(data[f]).trim() === "") {
      return { statusCode: 400, body: JSON.stringify({ error: `Feld fehlt: ${f}` }) };
    }
  }

  const emojiByCat = {
    musik: "🎸", sport: "🏃", kunst: "🎨", kino: "🎬",
    tech: "💻", food: "🍕", social: "🎉",
  };

  // Build display date from ISO + optional time
  let dateStr = data.isoDate;
  try {
    const time = (data.time && /^\d{2}:\d{2}$/.test(data.time)) ? data.time : "20:00";
    const d = new Date(data.isoDate + "T" + time + ":00");
    if (!isNaN(d)) {
      dateStr = d.toLocaleString("de-DE", {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
    }
  } catch {}

  // Price handling
  const priceFree = data.priceFree === true;
  let price;
  if (priceFree) {
    price = "Kostenlos";
  } else {
    const min = data.priceMin != null && data.priceMin !== "" ? Math.round(Number(data.priceMin)) : null;
    const max = data.priceMax != null && data.priceMax !== "" ? Math.round(Number(data.priceMax)) : null;
    if (min != null && max != null && max > min) price = `${min}–${max} €`;
    else if (min != null) price = `${min} €`;
    else price = "k.A.";
  }

  // Attendees
  const maxAttendees = data.maxAttendees != null && data.maxAttendees !== ""
    ? Math.max(0, Math.round(Number(data.maxAttendees))) : null;

  const newEvent = {
    id: "community-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    emoji: emojiByCat[data.cat] || "🎉",
    title: String(data.title).slice(0, 120),
    cat: data.cat,
    isoDate: String(data.isoDate).slice(0, 10),
    date: String(dateStr).slice(0, 60),
    city: String(data.city).slice(0, 60),
    loc: String(data.loc || data.city).slice(0, 120),
    price, priceFree,
    attendees: 0,
    maxAttendees,
    url: String(data.url || "").slice(0, 300),
    img: "",
    submittedAt: new Date().toISOString(),
  };

  try {
    const store = getStore({ name: "events", consistency: "strong" });
    const pending = (await store.get("pending", { type: "json" })) || [];
    pending.push(newEvent);
    await store.setJSON("pending", pending);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, message: "Event eingereicht – wird nach Prüfung freigeschaltet." }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
