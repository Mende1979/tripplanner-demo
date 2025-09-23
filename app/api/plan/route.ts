// app/api/plan/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  // (opzionale) Basic Auth via env
  const requiredUser = process.env.PLAN_API_USER;
  const requiredPass = process.env.PLAN_API_PASS;
  if (requiredUser && requiredPass) {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Basic ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const [u, p] = decoded.split(":");
    if (u !== requiredUser || p !== requiredPass) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Leggi input
  const body = await req.json().catch(() => ({} as any));
  const origin = body.origin ?? "Bologna, IT";
  const destinations: string[] =
    Array.isArray(body.destinations) && body.destinations.length
      ? body.destinations.slice(0, 3)
      : ["Valencia", "Lisbona", "Corsica"];
  const paxAdults = Number(body.paxAdults ?? 2);
  const paxChildren = Number(body.paxChildren ?? 0);
  const startDate = body.startDate ?? "";
  const endDate = body.endDate ?? "";
  const flexibleDays = Number(body.flexibleDays ?? 0);
  const budgetTotal = Number(body.budgetTotal ?? 1500);
  const currency = body.currency ?? "EUR";

  // TODO: qui in futuro farai le chiamate reali (voli/hotel/poi/meteo).
  // Per ora rispondiamo con mock “coerenti”.
  const mk = (
    destination: string,
    title: string,
    nights: number,
    priceTotal: number,
    transportSummary: string,
    hotelName: string,
    hotelArea: string,
    links: { transport: string; hotel: string; itinerary: string },
    topThings: string[]
  ) => ({
    destination,
    title,
    nights,
    priceTotal,
    currency,
    transportSummary,
    hotel: { name: hotelName, area: hotelArea },
    topThings,
    links,
  });

  const proposals = [
    mk(
      "Valencia, Spagna",
      "Città, mare e paella · 4 notti",
      4,
      Math.round(budgetTotal * 0.65),
      "✈️ 2h15 da BLQ • bagaglio incluso",
      "Petit Palace Ruzafa",
      "Ruzafa/centro",
      {
        transport: "https://www.skyscanner.it/",
        hotel:
          "https://www.booking.com/searchresults.html?ss=Valencia&checkin=" +
          (startDate || "") +
          "&checkout=" +
          (endDate || "") +
          `&group_adults=${paxAdults}`,
        itinerary: "https://goo.gl/maps/",
      },
      [
        "Città vecchia & Lonja",
        "Città delle Arti",
        "Malvarrosa",
        "Mercato Centrale",
        "Tapas a Ruzafa",
      ]
    ),
    mk(
      "Lisbona, Portogallo",
      "Tram, miradouros e pasteis · 5 notti",
      5,
      Math.round(budgetTotal * 0.75),
      "✈️ 3h da BLQ • 1 scalo breve",
      "My Story Hotel Ouro",
      "Baixa/Chiado",
      {
        transport: "https://www.skyscanner.it/",
        hotel:
          "https://www.booking.com/searchresults.html?ss=Lisbona&checkin=" +
          (startDate || "") +
          "&checkout=" +
          (endDate || "") +
          `&group_adults=${paxAdults}`,
        itinerary: "https://goo.gl/maps/",
      },
      ["Belém", "Alfama & tram 28", "Miradouro", "LX Factory", "Pastéis"]
    ),
    mk(
      "Corsica, Francia",
      "Strade panoramiche & calette · 6 notti",
      6,
      Math.round(budgetTotal * 0.6),
      "🚗 Da Bologna • traghetto da Livorno",
      "Les Calanches",
      "Piana/Porto",
      {
        transport: "https://www.directferries.it/",
        hotel:
          "https://www.booking.com/searchresults.html?ss=Corsica&checkin=" +
          (startDate || "") +
          "&checkout=" +
          (endDate || "") +
          `&group_adults=${paxAdults}`,
        itinerary: "https://goo.gl/maps/",
      },
      [
        "Calanche di Piana",
        "Riserva di Scandola",
        "Spiaggia Arone",
        "Strada D81",
        "Porto Marina",
      ]
    ),
  ];

  return NextResponse.json({ proposals }, { status: 200 });
}
