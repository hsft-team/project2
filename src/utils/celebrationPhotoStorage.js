const CELEBRATION_PHOTO_STORAGE_KEY = "attendance-celebration-photos";
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
    reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function optimizeImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      resolve(dataUrl);
      return;
    }

    const image = new window.Image();
    image.onload = () => {
      const maxSide = 1440;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const targetWidth = Math.max(1, Math.round(image.width * scale));
      const targetHeight = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const context = canvas.getContext("2d");
      if (!context) {
        resolve(dataUrl);
        return;
      }

      context.drawImage(image, 0, 0, targetWidth, targetHeight);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => reject(new Error("이미지를 변환하지 못했습니다."));
    image.src = dataUrl;
  });
}

export async function convertFilesToCelebrationPhotos(fileList) {
  const files = Array.from(fileList || []).filter((file) => file?.type?.startsWith("image/"));

  const convertedPhotos = [];
  for (const file of files) {
    const rawDataUrl = await readFileAsDataUrl(file);
    const optimizedDataUrl = await optimizeImageDataUrl(rawDataUrl);
    convertedPhotos.push({
      id: createPhotoId(),
      dataUrl: optimizedDataUrl,
      fileName: file.name || "photo.jpg",
      createdAt: new Date().toISOString(),
    });
  }

  return convertedPhotos;
}

export function loadCelebrationPhotos() {
  if (!isWebStorageAvailable()) {
    return [];
  }

  const raw = window.localStorage.getItem(CELEBRATION_PHOTO_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((photo) => typeof photo?.dataUrl === "string").slice(-MAX_CELEBRATION_PHOTOS);
  } catch (error) {
    window.localStorage.removeItem(CELEBRATION_PHOTO_STORAGE_KEY);
    return [];
  }
}

export function saveCelebrationPhotos(photos) {
  if (!isWebStorageAvailable()) {
    return;
  }

  const normalizedPhotos = (photos || []).slice(-MAX_CELEBRATION_PHOTOS);
  window.localStorage.setItem(
    CELEBRATION_PHOTO_STORAGE_KEY,
    JSON.stringify(normalizedPhotos)
  );
}

export function clearCelebrationPhotos() {
  if (!isWebStorageAvailable()) {
    return;
  }

  window.localStorage.removeItem(CELEBRATION_PHOTO_STORAGE_KEY);
}

export function selectRandomCelebrationPhoto(photos) {
  if (!photos?.length) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * photos.length);
  return photos[randomIndex];
}
