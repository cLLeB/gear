import { LazyStore } from "@tauri-apps/plugin-store";

// Uses Tauri's shared LazyStore (not IndexedDB) so the image is accessible
// from both the main window and the settings window.
const store = new LazyStore("Gear-bg-image.json", { defaults: {}, autoSave: 0 });
const DATA_KEY = "imageDataUrl";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function storeBgImage(file: File): Promise<void> {
  const dataUrl = await fileToDataUrl(file);
  await store.set(DATA_KEY, dataUrl);
  await store.save();
}

export async function getBgImage(): Promise<string | null> {
  return (await store.get<string>(DATA_KEY)) ?? null;
}

export async function deleteBgImage(): Promise<void> {
  await store.delete(DATA_KEY);
  await store.save();
}
