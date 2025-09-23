"use client";
import { useState } from "react";

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

    try {
      // Se vuoi collegare n8n, metti qui l'URL del tuo webhook
      // const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
      // const res = await fetch(API_URL, { ... });
      // const data = await res.json();
      // setProposals(data.proposals);

      // Per ora: dati finti di esempio
      setTimeout(() => {
        setProposals([
          {
            title: "Weekend a Roma",
            description:
              "Visita il Colosseo, il Vaticano e passeggia per Trastevere. Alloggio in centro città.",
            link: "https://www.booking.com"
          },
          {
            title: "Relax in Toscana",
            description:
              "Agriturismo tra le colline, degustazioni di vino e tour culturali a Firenze e Siena.",
            link: "https://www.airbnb.com"
          },
          {
            title: "Avventura sulle Dolomiti",
            description:
              "Escursioni panoramiche, relax in spa alpine e cucina tipica di montagna.",
            link: "https://www.tripadvisor.com"
          }
        ]);
        setLoading(false);
      }, 1000);
    } catch (err) {
      console.error(err);
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
