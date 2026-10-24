import axios from 'axios';

const PLACEHOLDER_CITY = 'mumbai';
const MOMENT_LOCATION_MAX = 100;

export type UploadedMomentLocation = {
  label: string | null;
  latitude: number | null;
  longitude: number | null;
};

const parseCoord = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
};

const cleanText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const joinPlace = (...parts: Array<string | null | undefined>): string | null => {
  const unique: string[] = [];
  for (const part of parts) {
    const text = part?.trim();
    if (!text) continue;
    if (unique.some((existing) => existing.toLowerCase() === text.toLowerCase())) continue;
    unique.push(text);
  }
  return unique.length > 0 ? unique.join(', ') : null;
};

const fitLabel = (label: string | null): string | null => {
  if (!label) return null;
  return label.length > MOMENT_LOCATION_MAX ? label.slice(0, MOMENT_LOCATION_MAX).trim() : label;
};

const readLocationObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value === 'string') return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  return null;
};

const readLocationJson = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
};

const labelFromPlace = (place: Record<string, unknown> | null): string | null => {
  if (!place) return null;
  return (
    cleanText(place.name) ||
    cleanText(place.label) ||
    cleanText(place.address) ||
    cleanText(place.fullLocation) ||
    cleanText(place.formattedLocation) ||
    joinPlace(
      cleanText(place.city),
      cleanText(place.county),
      cleanText(place.state),
      cleanText(place.country)
    )
  );
};

/**
 * Reads the place the client sent with a moment upload.
 * Accepts a label, a location object, a JSON location string, or coordinates.
 */
export const readUploadedMomentLocation = (body: any): UploadedMomentLocation => {
  const source = body || {};
  const locationObject = readLocationObject(source.location) || readLocationJson(source.location);
  const labelObject = readLocationObject(source.locationLabel) || readLocationJson(source.locationLabel);

  const label =
    labelFromPlace(locationObject) ||
    (!locationObject && typeof source.location === 'string' ? cleanText(source.location) : null) ||
    labelFromPlace(labelObject) ||
    (!labelObject ? cleanText(source.locationLabel) : null) ||
    cleanText(source.address) ||
    cleanText(source.placeName) ||
    cleanText(source.place) ||
    joinPlace(
      cleanText(source.city),
      cleanText(source.county),
      cleanText(source.state),
      cleanText(source.country)
    );

  const latitude = parseCoord(
    locationObject?.latitude ??
      locationObject?.lat ??
      labelObject?.latitude ??
      labelObject?.lat ??
      source.latitude ??
      source.lat
  );
  const longitude = parseCoord(
    locationObject?.longitude ??
      locationObject?.lng ??
      locationObject?.longitutute ??
      labelObject?.longitude ??
      labelObject?.lng ??
      source.longitude ??
      source.lng ??
      source.longitutute
  );

  return {
    label: fitLabel(label),
    latitude,
    longitude,
  };
};

/**
 * The users.city column defaults to Mumbai. That value is not a place the user chose
 * unless they also saved coordinates.
 */
export const isUnsetProfileCity = (
  city?: string | null,
  latitude?: number | null,
  longitude?: number | null
): boolean => {
  if (!city || !city.trim()) return true;
  if (city.trim().toLowerCase() !== PLACEHOLDER_CITY) return false;
  return latitude == null || longitude == null;
};

export const formatReverseGeocodeAddress = (address: any): string | null => {
  if (!address || typeof address !== 'object') return null;
  const city =
    cleanText(address.city) ||
    cleanText(address.town) ||
    cleanText(address.village) ||
    cleanText(address.hamlet) ||
    cleanText(address.suburb) ||
    cleanText(address.municipality) ||
    cleanText(address.county);
  const state = cleanText(address.state);
  return fitLabel(joinPlace(city, state));
};

export const reverseGeocode = async (
  latitude: number,
  longitude: number
): Promise<string | null> => {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        format: 'jsonv2',
        lat: latitude,
        lon: longitude,
        zoom: 12,
        addressdetails: 1,
      },
      headers: {
        'User-Agent': 'FlirtTime/1.0 (moment-location)',
        Accept: 'application/json',
      },
      timeout: 2500,
    });
    return formatReverseGeocodeAddress(response.data?.address);
  } catch {
    return null;
  }
};

export const resolveMomentLocationLabel = async (input: {
  uploadedLabel?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  profileCity?: string | null;
  profileLatitude?: number | null;
  profileLongitude?: number | null;
}): Promise<string | null> => {
  const uploaded = fitLabel(input.uploadedLabel?.trim() || null);
  if (uploaded) return uploaded;

  if (input.latitude != null && input.longitude != null) {
    const fromUpload = await reverseGeocode(input.latitude, input.longitude);
    if (fromUpload) return fromUpload;
  }

  const profileCity = input.profileCity?.trim() || null;
  if (
    profileCity &&
    !isUnsetProfileCity(profileCity, input.profileLatitude, input.profileLongitude)
  ) {
    return fitLabel(profileCity);
  }

  if (input.profileLatitude != null && input.profileLongitude != null) {
    return reverseGeocode(input.profileLatitude, input.profileLongitude);
  }

  return null;
};
