const AUTH_STORAGE_KEY = "attendance-auth";
const DEVICE_ID_STORAGE_KEY = "attendance-device-id";

function isWebStorageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function createRandomId() {
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getOrCreateDeviceId() {
  if (!isWebStorageAvailable()) {
    return "native-session-device";
  }

  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const nextId = createRandomId();
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, nextId);
  return nextId;
}

export function getDeviceName() {
  if (typeof navigator === "undefined") {
    return "Attendance App";
  }

  const userAgent = navigator.userAgent || "Unknown Device";
  return userAgent.slice(0, 180);
}

export function saveAuth(auth) {
  if (!isWebStorageAvailable()) {
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function loadAuth() {
  if (!isWebStorageAvailable()) {
    return null;
  }

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt) {
      return null;
    }

    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch (error) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function clearAuth() {
  if (!isWebStorageAvailable()) {
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}
