// Single source of truth for the remote leaderboard endpoint. Empty
// string = remote sync disabled; the local localStorage leaderboard
// still works unchanged, so a new clone of the repo runs fine without
// any Worker deployed.
//
// To enable remote sync:
//   1. Deploy the worker under worker/ via wrangler — it prints the
//      URL (e.g. https://tacticalrogue-api.yourname.workers.dev).
//   2. Paste that URL here (no trailing slash) OR set it at runtime
//      via `window.__apiBase = '...'` before the bundle loads.
//
// Runtime override wins so you can point a staging build at a
// different deployment without editing the source.
const COMPILED_API_BASE = '';

export function apiBase() {
  if (typeof window !== 'undefined' && typeof window.__apiBase === 'string') {
    return window.__apiBase.replace(/\/+$/, '');
  }
  return COMPILED_API_BASE.replace(/\/+$/, '');
}

export function apiEnabled() {
  return apiBase().length > 0;
}
