const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  const category = event.queryStringParameters?.category || "";
  const cityParam = event.queryStringParameters?.city || "alle";
  const dateFrom = event.queryStringParameters?.from || "";
  const dateTo = event.queryStringParameters?.to || "";

  const segmentMap = {
    musik: "Music", sport: "Sports", kunst: "Arts & Theatre",
    kino: "Film", social: "Miscellaneous",
  };
  const emojiBySegment = {
    "Music": "🎸", "Sports": "🏃", "Arts & Theatre": "🎨",
    "Film": "🎬", "Miscellaneous": "🎉", "Family": "🎪",
  };
  const catBySegment = {
    "Music": "musik", "Sports": "sport", "Arts & Theatre": "kunst",
    "Film": "kino", "Miscellaneous": "social", "Family": "social",
  };
  const CITIES = { nuernberg: "Nürnberg", muenchen: "München", regensburg: "Regensburg" };

  const key = process.env.TICKETMASTER_KEY;

  let cities;
  if (cityParam === "alle") cities = Object.values(CITIES);
  else if (CITIES[cityParam]) cities = [CITIES[cityParam]];
  else cities = Object.values(CITIES);

  const segment = segmentMap[category];

  function buildUrl(city) {
    const params = new URLSearchParams({
      apikey: key, city, countryCode: "DE", radius: "25", unit: "km",
      locale: "*", size: "30", sort: "date,asc",
    });
    if (segment) params.append("segmentName", segment);
    // Ticketmaster supports date filtering too
    if (dateFrom) params.append("startDateTime", dateFrom + "T00:00:00Z");
    if (dateTo) params.append("endDateTime", dateTo + "T23:59:59Z");
    return `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;
  }

  function mapEvent(e) {
    const venue = e._embedded?.venues?.[0];
    const seg = e.classifications?.[0]?.segment?.name || "Miscellaneous";
    const start = e.dates?.start;

    // Price range
    let price = "Ticket", priceFree = false;
    if (e.priceRanges?.[0]) {
      const p = e.priceRanges[0];
      const cur = p.currency === "EUR" ? "€" : p.currency;
      const min = Math.round(p.min), max = Math.round(p.max);
      if (min === 0 && max === 0) { price = "Kostenlos"; priceFree = true; }
      else if (min === max) price = `${min} ${cur}`;
      else price = `${min}–${max} ${cur}`;
    }

    // ISO date + display date
    let dateStr = "Datum offen", isoDate = "";
    if (start?.localDate) {
      isoDate = start.localDate;
      const d = new Date(start.localDate + "T" + (start.localTime || "20:00") + ":00");
      dateStr = d.toLocaleString("de-DE", {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
    }

    return {
      id: e.id, emoji: emojiBySegment[seg] || "🎉", title: e.name,
      cat: catBySegment[seg] || "social", date: dateStr, isoDate,
      city: venue?.city?.name || "",
      loc: venue ? venue.name + ", " + (venue.city?.name || "") : "",
      price, priceFree,
      attendees: null, maxAttendees: null,
      url: e.url, source: "ticketmaster",
      img: e.images?.find((i) => i.ratio === "16_9" && i.width > 500)?.url || e.images?.[0]?.url || null,
    };
  }

  function cityMatches(ev) {
    if (cityParam === "alle") return true;
    const target = CITIES[cityParam];
    return ev.city && target && ev.city.toLowerCase().includes(target.toLowerCase());
  }
  function catMatches(ev) {
    if (!category) return true;
    return ev.cat === category;
  }
  function dateMatches(ev) {
    if (!ev.isoDate) return true; // keep events without a date
    if (dateFrom && ev.isoDate < dateFrom) return false;
    if (dateTo && ev.isoDate > dateTo) return false;
    return true;
  }

  let events = [];

  // 1. Ticketmaster
  if (key) {
    try {
      const results = await Promise.all(
        cities.map(async (city) => {
          const res = await fetch(buildUrl(city));
          if (!res.ok) return [];
          const data = await res.json();
          return (data?._embedded?.events || []).map(mapEvent);
        })
      );
      for (const list of results) events.push(...list);
    } catch (err) { /* ignore */ }
  }

  // 2. Curated local events
  try {
    const base = process.env.URL || `https://${event.headers.host}`;
    const res = await fetch(`${base}/local-events.json`);
    if (res.ok) {
      const data = await res.json();
      const local = (data.events || [])
        .map((e) => ({ ...e, source: "local", img: e.img || null,
          attendees: e.attendees ?? null, maxAttendees: e.maxAttendees ?? null,
          priceFree: e.priceFree ?? false, isoDate: e.isoDate || "" }))
        .filter(cityMatches).filter(catMatches).filter(dateMatches);
      events.push(...local);
    }
  } catch (err) { /* ignore */ }

  // 3. Approved community events
  try {
    const store = getStore("events");
    const approved = (await store.get("approved", { type: "json" })) || [];
    const userEvents = approved
      .map((e) => ({ ...e, source: "community", img: e.img || null,
        attendees: e.attendees ?? null, maxAttendees: e.maxAttendees ?? null,
        priceFree: e.priceFree ?? false, isoDate: e.isoDate || "" }))
      .filter(cityMatches).filter(catMatches).filter(dateMatches);
    events.push(...userEvents);
  } catch (err) { /* ignore */ }

  // Dedupe + shuffle
  const seen = new Set();
  const out = [];
  for (const ev of events) {
    if (!seen.has(ev.id)) { seen.add(ev.id); out.push(ev); }
  }
  out.sort(() => Math.random() - 0.5);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(out),
  };
};
