const CELEBRATION_STORAGE_KEY = "attendance-celebration-settings";
export const MAX_CELEBRATION_PHOTOS = 10;

function isWebStorageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function createPhotoId() {
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function resizeImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      resolve(dataUrl);
      return;
    }

    const image = new window.Image();
    image.onload = () => {
      const maxSide = 1440;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) {
        resolve(dataUrl);
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => reject(new Error("이미지를 변환하지 못했습니다."));
    image.src = dataUrl;
  });
}

export function loadCelebrationSettings() {
  if (!isWebStorageAvailable()) {
    return {
      enabled: false,
      photos: [],
    };
  }

  const raw = window.localStorage.getItem(CELEBRATION_STORAGE_KEY);
  if (!raw) {
    return {
      enabled: false,
      photos: [],
      activePhotoId: null,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed?.enabled),
      photos: Array.isArray(parsed?.photos)
        ? parsed.photos.filter((photo) => typeof photo?.dataUrl === "string").slice(-MAX_CELEBRATION_PHOTOS)
        : [],
      activePhotoId: typeof parsed?.activePhotoId === "string" ? parsed.activePhotoId : null,
    };
  } catch (error) {
    window.localStorage.removeItem(CELEBRATION_STORAGE_KEY);
    return {
      enabled: false,
      photos: [],
      activePhotoId: null,
    };
  }
}

export function saveCelebrationSettings(settings) {
  if (!isWebStorageAvailable()) {
    return;
  }

  const normalized = {
    enabled: Boolean(settings?.enabled),
    photos: Array.isArray(settings?.photos)
      ? settings.photos.slice(-MAX_CELEBRATION_PHOTOS)
      : [],
    activePhotoId: typeof settings?.activePhotoId === "string" ? settings.activePhotoId : null,
  };

  window.localStorage.setItem(CELEBRATION_STORAGE_KEY, JSON.stringify(normalized));
}

export async function convertFilesToCelebrationPhotos(fileList) {
  const files = Array.from(fileList || []).filter((file) => file?.type?.startsWith("image/"));
  const converted = [];

  for (const file of files) {
    const rawDataUrl = await readFileAsDataUrl(file);
    const optimizedDataUrl = await resizeImageDataUrl(rawDataUrl);
    converted.push({
      id: createPhotoId(),
      dataUrl: optimizedDataUrl,
      fileName: file.name || "photo.jpg",
      createdAt: new Date().toISOString(),
    });
  }

  return converted;
}

export function pickRandomCelebrationPhoto(photos) {
  if (!photos?.length) {
    return null;
  }

  return photos[Math.floor(Math.random() * photos.length)];
}
