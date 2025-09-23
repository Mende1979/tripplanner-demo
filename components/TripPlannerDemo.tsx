"use client";
import { useState } from "react";

interface Proposal {
  title: string;
  description: string;
  link: string;
}

type ApiLinks = { transport?: string; hotel?: string; itinerary?: string };
type ApiHotel = { name: string; area?: string };
type ApiProposal = {
  destination?: string;
  title?: string;
  nights?: number;
  priceTotal?: number;
  currency?: string;
  transportSummary?: string;
  hotel?: ApiHotel;
  topThings?: string[];
  links?: ApiLinks;
};

const API_URL = "/api/plan";

export default function TripPlannerDemo() {
  // campi form (tutti usati nel JSX)
  const [destination, setDestination] = useState("");
  const [people, setPeople] = useState(2);
  const [transport, setTransport] = useState<string[]>([]);
  const [budget, setBudget] = useState("");

  // stato risultati
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);

  const toggleTransport = (t: string) => {
    setTransport((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const handleSubmit = async () => {
    setLoading(true);
    setProposals([]);

    const parseBudget = (s: string) => {
      const n = Number((s || "").replace(/[^0-9]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : 1500;
    };

    try {
      const payload = {
        origin: "Bologna, IT",
        destinations: destination ? [destination] : [],
        paxAdults: people,
        paxChildren: 0,
        transport: transport.map((t) => t.toLowerCase()),
        startDate: "",
        endDate: "",
        flexibleDays: 0,
        budgetTotal: parseBudget(budget),
        currency: "EUR",
      };

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data: { proposals?: ApiProposal[] } = await res.json();

      const mapped: Proposal[] = (data.proposals ?? []).map((p) => ({
        title:
          p.title ??
          `${p.destination ?? "Proposta"}${
            p.nights ? ` • ${p.nights} notti` : ""
          }`,
        description: [
          p.destination,
          p.transportSummary,
          p.hotel?.name
            ? `Hotel: ${p.hotel.name}${
                p.hotel?.area ? ` (${p.hotel.area})` : ""
              }`
            : "",
          Array.isArray(p.topThings) && p.topThings.length
            ? `Da non perdere: ${p.topThings.slice(0, 3).join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" • "),
        link: p.links?.hotel || p.links?.transport || p.links?.itinerary || "#",
      }));

      setProposals(mapped);
    } catch (err) {
      console.error(err);
      // fallback se l'API fallisce
      setProposals([
        {
          title: "Weekend a Roma",
          description:
            "Colosseo, Vaticano, Trastevere • Hotel in centro",
          link: "https://www.booking.com",
        },
        {
          title: "Relax in Toscana",
          description:
            "Agriturismo tra le colline • Degustazioni e Firenze/Siena",
          link: "https://www.airbnb.com",
        },
        {
          title: "Dolomiti avventura",
          description: "Trekking • Spa alpine • Cucina tipica",
          link: "https://www.tripadvisor.com",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-xl shadow">
      <h1 className="text-2xl font-bold mb-4">TripPlanner Demo</h1>

      <div className="flex flex-col gap-4">
        <input
          className="border rounded p-2"
          placeholder="Dove vuoi andare?"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />

        <div className="flex items-center gap-3">
          <label className="font-medium">Persone:</label>
          <input
            type="number"
            className="border rounded p-2 w-24"
            min={1}
            value={people}
            onChange={(e) => setPeople(Math.max(1, Number(e.target.value)))}
          />
        </div>

        <div>
          <p className="font-medium mb-2">Trasporto (uno o più):</p>
          <div className="flex gap-2 flex-wrap">
            {["Auto", "Treno", "Aereo"].map((t) => (
              <button
                key={t}
                type="button"
                className={`px-3 py-1 border rounded ${
                  transport.includes(t) ? "bg-blue-600 text-white" : ""
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
          placeholder="Budget (es. 1200€)"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          {loading ? "Sto cercando..." : "Genera 3 proposte"}
        </button>
      </div>

      {proposals.length > 0 && (
        <div className="mt-6 space-y-4">
          <h2 className="text-xl font-semibold">Proposte</h2>
          {proposals.map((p, i) => (
            <div key={i} className="border rounded p-4">
              <h3 className="text-lg font-bold">{p.title}</h3>
              <p className="text-gray-700">{p.description}</p>
              <a
                href={p.link}
                target="_blank"
                rel="noreferrer"
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

