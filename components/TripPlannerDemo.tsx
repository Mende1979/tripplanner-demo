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


  return (
    <div className="max-w-2xl mx-auto p-6 bg-white shadow-lg rounded-xl">
      <h1 className="text-2xl font-bold mb-4">TripPlanner Demo 🧳</h1>

      <div className="flex flex-col gap-4">
        <input
          className="border rounded p-2"
          placeholder="Dove vuoi andare?"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />

        <input
          type="number"
          className="border rounded p-2"
          placeholder="Numero di persone"
          value={people}
          min={1}
          onChange={(e) => setPeople(parseInt(e.target.value))}
        />

        <div>
          <p className="font-semibold mb-1">Trasporto:</p>
          <div className="flex gap-2">
            {transports.map((t) => (
              <button
                key={t}
                className={`px-3 py-1 border rounded ${
                  transport.includes(t) ? "bg-blue-500 text-white" : ""
                }`}
                onClick={() => toggleTransport(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <input
          className="border rounded p-2"
          placeholder="Periodo (es. agosto, flessibile)"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />

        <input
          className="border rounded p-2"
          placeholder="Budget (es. 1000€)"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          {loading ? "Sto cercando..." : "Genera 3 proposte"}
        </button>
      </div>

      {proposals.length > 0 && (
        <div className="mt-6 space-y-4">
          <h2 className="text-xl font-semibold">Le tue proposte:</h2>
          {proposals.map((p, i) => (
            <div key={i} className="border p-4 rounded shadow-sm">
              <h3 className="text-lg font-bold">{p.title}</h3>
              <p className="text-gray-700">{p.description}</p>
              <a
                href={p.link}
                target="_blank"
                className="text-blue-600 hover:underline"
              >
                Prenota →
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
