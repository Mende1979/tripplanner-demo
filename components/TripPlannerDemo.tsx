"use client";
import { useState } from "react";

// URL dell’API: se è definita una variabile d’ambiente NEXT_PUBLIC_API_URL la usa, altrimenti la rotta interna
const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api/plan";

interface Proposal {
  title: string;
  description: string;
  link: string;
}

export default function TripPlannerDemo() {
  const [destination, setDestination] = useState("");
  const [people, setPeople] = useState(1);
  const [transport, setTransport] = useState<string[]>([]);
  const [period, setPeriod] = useState("");
  const [budget, setBudget] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);

  const transports = ["Auto", "Treno", "Aereo"];

  const toggleTransport = (t: string) => {
    setTransport((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const handleSubmit = async () => {
  setLoading(true);
  setProposals([]);

  // piccolo helper: pulisce il budget (es. "1.500€" -> 1500)
  const parseBudget = (s: string) => {
    const n = Number((s || "").replace(/[^0-9]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 1500;
  };

  try {
    // prepara il payload per l'API
    const payload = {
      origin: "Bologna, IT",                       // se hai un campo origin, usa quello
      destinations: destination ? [destination] : [],
      paxAdults: people,
      paxChildren: 0,
      transport: transport.map(t => t.toLowerCase()), // non obbligatorio per l’MVP
      startDate: "",                                // se hai date reali, passale qui
      endDate: "",
      flexibleDays: 0,
      budgetTotal: parseBudget(budget),
      currency: "EUR"
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Se proteggi l'API con Basic Auth, aggiungi:
        // "Authorization": "Basic " + btoa(`${process.env.NEXT_PUBLIC_PLAN_USER}:${process.env.NEXT_PUBLIC_PLAN_PASS}`)
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();

    // mappa l’oggetto API -> Proposal[] del tuo componente
    const mapped: Proposal[] = (data.proposals || []).map((p: any) => ({
      title: p.title || `${p.destination || "Proposta"}${p.nights ? ` • ${p.nights} notti` : ""}`,
      description: [
        p.destination,
        p.transportSummary,
        p.hotel?.name ? `Hotel: ${p.hotel.name}${p.hotel?.area ? ` (${p.hotel.area})` : ""}` : "",
        Array.isArray(p.topThings) && p.topThings.length
          ? `Da non perdere: ${p.topThings.slice(0, 3).join(", ")}`
          : ""
      ].filter(Boolean).join(" • "),
      link: p.links?.hotel || p.links?.transport || p.links?.itinerary || "#",
    }));

    setProposals(mapped);
  } catch (err) {
    console.error(err);
    // Fallback: mostra 3 proposte finte se l’API fallisce
    setProposals([
      {
        title: "Weekend a Roma",
        description: "Colosseo, Vaticano, Trastevere • Hotel in centro",
        link: "https://www.booking.com"
      },
      {
        title: "Relax in Toscana",
        description: "Agriturismo tra le colline • Degustazioni e Firenze/Siena",
        link: "https://www.airbnb.com"
      },
      {
        title: "Dolomiti avventura",
        description: "Trekking panoramici • Spa alpine • Cucina tipica",
        link: "https://www.tripadvisor.com"
      }
    ]);
  } finally {
    setLoading(false);
  }
};
