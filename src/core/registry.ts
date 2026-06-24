import type { PlatformAdapter } from './adapter';

const adapters: PlatformAdapter[] = [];

export function registerAdapter(adapter: PlatformAdapter): void {
  adapters.push(adapter);
}

export function getAdapterForUrl(url: string): PlatformAdapter | undefined {
  return adapters.find((a) => a.matches(url));
}

export function getAllAdapters(): PlatformAdapter[] {
  return [...adapters];
}

export function getAdapterById(id: string): PlatformAdapter | undefined {
  return adapters.find((a) => a.id === id);
}
