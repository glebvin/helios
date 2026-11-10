export type Place = {
  address: string;
  latitude: number;
  longitude: number;
};

export function parsePlace(input: { address?: unknown; latitude?: unknown; longitude?: unknown }): Place | null {
  if (input.address !== undefined && typeof input.address !== "string") return null;
  const address = String(input.address ?? "").trim();
  if (address.length > 300) return null;
  const latitude = coordinate(input.latitude);
  const longitude = coordinate(input.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { address, latitude: round(latitude), longitude: round(longitude) };
}

function coordinate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round(value: number) {
  return Math.round(value * 1e6) / 1e6;
}
