const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async function (event) {
  connectLambda(event);
  const category = event.queryStringParameters?.category || "";
  const cityParam = event.queryStringParameters?.city || "alle";

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

  // Cities with geo-coordinates (Ticketmaster city= search fails for DE,
  // so we use latlong + radius which works reliably)
  const CITIES = {
    nuernberg:  { name: "Nürnberg",   lat: 49.4521, lon: 11.0767 },
    muenchen:   { name: "München",    lat: 48.1351, lon: 11.5820 },
    regensburg: { name: "Regensburg", lat: 49.0134, lon: 12.1016 },
  };

  const key = process.env.TICKETMASTER_KEY;

  let cityKeys;
  if (cityParam === "alle") cityKeys = Object.keys(CITIES);
  else if (CITIES[cityParam]) cityKeys = [cityParam];
  else cityKeys = Object.keys(CITIES);

  const segment = segmentMap[category];

  function buildUrl(city) {
    const params = new URLSearchParams({
      apikey: key,
      latlong: `${city.lat},${city.lon}`,
      radius: "30",
      unit: "km",
      locale: "*",
      size: "30",
      sort: "date,asc",
      countryCode: "DE",
    });
    if (segment) params.append("segmentName", segment);
    return `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;
  }

  function mapEvent(e) {
    const venue = e._embedded?.venues?.[0];
    const seg = e.classifications?.[0]?.segment?.name || "Miscellaneous";
    const start = e.dates?.start;
    let price = "Ticket";
    if (e.priceRanges?.[0]) {
      const p = e.priceRanges[0];
      const min = Math.round(p.min);
      const max = Math.round(p.max);
      if (min === 0 && max === 0) price = "Gratis";
      else if (min === max) price = `${min} €`;
      else price = `${min}–${max} €`;
    }
    let dateStr = "Datum offen";
    let isoDate = start?.localDate || "";
    if (start?.localDate) {
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
      price,
      priceFree: price === "Gratis",
      attendees: null, maxAttendees: null,
      url: e.url, source: "ticketmaster",
      img: e.images?.find((i) => i.ratio === "16_9" && i.width > 500)?.url || e.images?.[0]?.url || null,
    };
  }

  function catMatches(ev) {
    if (!category) return true;
    return ev.cat === category;
  }

  let events = [];
  let tmError = null;

  // 1. Ticketmaster via geo-search
  if (key) {
    try {
      const results = await Promise.all(
        cityKeys.map(async (ck) => {
          const res = await fetch(buildUrl(CITIES[ck]));
          if (!res.ok) { tmError = `TM ${res.status}`; return []; }
          const data = await res.json();
          return (data?._embedded?.events || []).map(mapEvent);
        })
      );
      for (const list of results) events.push(...list);
    } catch (err) { tmError = err.message; }
  }

  // 2. Curated local events
  try {
    const base = process.env.URL || `https://${event.headers.host}`;
    const res = await fetch(`${base}/local-events.json`);
    if (res.ok) {
      const data = await res.json();
      const local = (data.events || [])
        .map((e) => ({ ...e, source: "local", img: e.img || null }))
        .filter((e) => cityParam === "alle" || (e.city && CITIES[cityParam] && e.city.toLowerCase().includes(CITIES[cityParam].name.toLowerCase())))
        .filter(catMatches);
      events.push(...local);
    }
  } catch (err) { /* ignore */ }

  // 3. Approved community events
  try {
    const store = getStore({ name: "events", consistency: "strong" });
    const approved = (await store.get("approved", { type: "json" })) || [];
    const userEvents = approved
      .map((e) => ({ ...e, source: "community", img: e.img || null }))
      .filter((e) => cityParam === "alle" || (e.city && CITIES[cityParam] && e.city.toLowerCase().includes(CITIES[cityParam].name.toLowerCase())))
      .filter(catMatches);
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
