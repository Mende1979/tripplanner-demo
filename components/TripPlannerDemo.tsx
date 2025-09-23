"use client";
import { useState } from "react";

interface Proposal { title: string; description: string; link: string; }

// Se vuoi fisso per test:
const API_URL = "/api/plan";

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

export default function TripPlannerDemo() {
  const [destination, setDestination] = useState("");
  const [people] = useState(2);            // rimuovo setter inutilizzati
  const [transport] = useState<string[]>([]);
  const [budget] = useState("");

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);

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
          `${p.destination ?? "Proposta"}${p.nights ? ` • ${p.nights} notti` : ""}`,
        description: [
          p.destination,
          p.transportSummary,
          p.hotel?.name ? `Hotel: ${p.hotel.name}${p.hotel?.area ? ` (${p.hotel.area})` : ""}` : "",
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
      setProposals([
        { title: "Weekend a Roma", description: "Colosseo, Vaticano, Trastevere • Hotel in centro", link: "https://www.booking.com" },
        { title: "Relax in Toscana", description: "Agriturismo tra le colline • Degustazioni e Firenze/Siena", link: "https://www.airbnb.com" },
        { title: "Dolomiti avventura", description: "Trekking panoramici • Spa alpine • Cucina tipica", link: "https://www.tripadvisor.com" },
      ]);
    } finally {
      setLoading(false);
    }
  };
