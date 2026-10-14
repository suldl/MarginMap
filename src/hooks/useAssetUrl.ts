import { useEffect, useState } from 'react';
import { backend } from '../backend';

const urls = new Map<string, Promise<string | null>>();

/** Object URL for a stored asset (cached for the session). */
export function assetUrl(id: string): Promise<string | null> {
  let p = urls.get(id);
  if (!p) {
    p = backend
      .getAsset(id)
      .then((blob) => (blob ? URL.createObjectURL(blob) : null))
      .catch(() => null);
    urls.set(id, p);
  }
  return p;
}

export function useAssetUrl(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (id) void assetUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

export async function assetDataUrl(id: string): Promise<string | null> {
  const blob = await backend.getAsset(id);
  if (!blob) return null;
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}
