/** Step 7 — measure the route, never infer it from ZIPs. Yard → stops → yard. */
import type { FamilyValue } from "../config/schema";

export interface Stop {
  id: string;
  lat: number;
  lng: number;
}

export interface RouteResult {
  order: string[];
  miles: number;
  minutes: number;
  legs: Array<{ from: string; to: string; miles: number }>;
  note?: string;
}

const MAX_BRUTE = 7;

export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function routeDay(stops: Stop[], yard: FamilyValue<"yard">): RouteResult {
  const depot = { id: "yard", lat: yard.latitude, lng: yard.longitude };
  const road = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => haversineMiles(a, b) * yard.road_factor;
  if (stops.length === 0) return { order: [], miles: 0, minutes: 0, legs: [] };
  let best: Stop[] = stops;
  let bestMiles = Infinity;
  let note: string | undefined;
  const candidates = stops.length <= MAX_BRUTE ? permutations(stops) : [nearestNeighbour(stops, depot, road)];
  if (stops.length > MAX_BRUTE) note = `${stops.length} stops — nearest-neighbour order, not exhaustive`;
  for (const perm of candidates) {
    const m = totalMiles(perm, depot, road);
    if (m < bestMiles) {
      bestMiles = m;
      best = perm;
    }
  }
  const legs: RouteResult["legs"] = [];
  let prev: { id: string; lat: number; lng: number } = depot;
  for (const s of [...best, depot]) {
    legs.push({ from: prev.id, to: s.id, miles: round1(road(prev, s)) });
    prev = s;
  }
  const miles = round1(bestMiles);
  return { order: best.map((s) => s.id), miles, minutes: Math.round((miles / yard.loaded_mph) * 60), legs, ...(note ? { note } : {}) };
}

function totalMiles(order: Stop[], depot: Stop, road: (a: Stop, b: Stop) => number) {
  let m = 0;
  let prev = depot;
  for (const s of order) {
    m += road(prev, s);
    prev = s;
  }
  return m + road(prev, depot);
}
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}
function nearestNeighbour(stops: Stop[], depot: Stop, road: (a: Stop, b: Stop) => number): Stop[] {
  const left = [...stops];
  const out: Stop[] = [];
  let cur = depot;
  while (left.length) {
    left.sort((a, b) => road(cur, a) - road(cur, b));
    cur = left.shift()!;
    out.push(cur);
  }
  return out;
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}
