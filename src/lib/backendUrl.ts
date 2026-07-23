import { Capacitor } from '@capacitor/core';

const LOCAL_BACKEND_URL = 'http://127.0.0.1:8012';
const ANDROID_EMULATOR_BACKEND_URL = 'http://10.0.2.2:8012';
const RENDER_BACKEND_URL = 'https://fit-coach-ai-backend-ms4i.onrender.com';
const UNCONFIGURED_CUSTOM_BACKEND_HOST = 'api.aifitcoach.dev';

function isLoopbackHost(value: string): boolean {
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

function isPublicOrigin(currentOrigin: string): boolean {
  try {
    return !isLoopbackHost(new URL(currentOrigin).hostname);
  } catch {
    return false;
  }
}

function inferRenderBackendUrl(currentOrigin: string): string | null {
  try {
    const url = new URL(currentOrigin);
    if (!url.hostname.endsWith('.onrender.com')) {
      return null;
    }

    const backendHost = url.hostname
      .replace('-frontend.', '-backend.')
      .replace('frontend.', 'backend.');

    return backendHost === url.hostname ? null : `${url.protocol}//${backendHost}`;
  } catch {
    return null;
  }
}

export function resolveConfiguredBackendUrl(configured: string): string {
  const normalized = configured.replace(/\/$/, '');
  try {
    if (new URL(normalized).hostname === UNCONFIGURED_CUSTOM_BACKEND_HOST) {
      return RENDER_BACKEND_URL;
    }
  } catch {
    return normalized;
  }
  return normalized;
}

export function isPublicAppOrigin(): boolean {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return false;
  }
  return isPublicOrigin(window.location.origin);
}

export function getBackendBaseUrl(): string {
  const configured = import.meta.env.VITE_AI_BACKEND_URL?.trim();
  if (configured) {
    const normalized = resolveConfiguredBackendUrl(configured);
    if (typeof window !== 'undefined' && window.location?.origin && isPublicOrigin(window.location.origin)) {
      try {
        if (isLoopbackHost(new URL(normalized).hostname)) {
          return window.location.origin.replace(/\/$/, '');
        }
      } catch {
        return window.location.origin.replace(/\/$/, '');
      }
    }
    return normalized;
  }

  if (Capacitor.isNativePlatform()) {
    return Capacitor.getPlatform() === 'android'
      ? ANDROID_EMULATOR_BACKEND_URL
      : LOCAL_BACKEND_URL;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    const inferredRenderBackend = inferRenderBackendUrl(window.location.origin);
    if (inferredRenderBackend) {
      return inferredRenderBackend;
    }
    return window.location.origin.replace(/\/$/, '');
  }

  return LOCAL_BACKEND_URL;
}

export const AI_BACKEND_URL = getBackendBaseUrl();
