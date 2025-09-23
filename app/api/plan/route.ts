// app/api/plan/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

type PlanRequest = {
  origin?: string;
  destinations?: string[];
  paxAdults?: number;
  paxChildren?: number;
  startDate?: string;
  endDate?: string;
  flexibleDays?: number;
  budgetTotal?: number;
  currency?: string;
  transport?: string[];
};

type ApiLinks = { transport?: string; hotel?: string; itinerary?: string };
type ApiHotel = { name: string; area?: string };
type ApiProposal = {
  destination: string;
  title: string;
  nights: number;
  priceTotal: number;
  currency: string;
  transportSummary: string;
  hotel: ApiHotel;
  topThings: string[];
  links: ApiLinks;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as PlanRequest;

  const budgetTotal = Math.max(1, Number(body.budgetTotal ?? 1500));
  const paxAdults = Math.max(1, Number(body.paxAdults ?? 2));
  const startDate = body.startDate ?? "";
  const endDate = body.endDate ?? "";
  const currency = body.currency ?? "EUR";

  const mk = (
    destination: string,
    title: string,
    nights: number,
    priceTotal: number,
    transportSummary: string,
    hotelName: string,
    hotelArea: string,
    links: ApiLinks,
    topThings: string[]
  ): ApiProposal => ({
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

  const proposals: ApiProposal[] = [
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
        hotel: `https://www.booking.com/searchresults.html?ss=Valencia&checkin=${startDate}&checkout=${endDate}&group_adults=${paxAdults}`,
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
        hotel: `https://www.booking.com/searchresults.html?ss=Lisbona&checkin=${startDate}&checkout=${endDate}&group_adults=${paxAdults}`,
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
        hotel: `https://www.booking.com/searchresults.html?ss=Corsica&checkin=${startDate}&checkout=${endDate}&group_adults=${paxAdults}`,
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
