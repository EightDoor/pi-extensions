import { useEffect, useState } from "react";
import type { DetailView } from "../model.ts";

const params = new URLSearchParams(location.hash.slice(1));
const token = params.get("token") ?? sessionStorage.getItem("inspector-token") ?? "";
export const generation = params.get("generation") ?? sessionStorage.getItem("inspector-generation") ?? "";
if (token) sessionStorage.setItem("inspector-token", token);
if (generation) sessionStorage.setItem("inspector-generation", generation);
history.replaceState(null, "", location.pathname);
export function headers(): HeadersInit {
  return { "X-Inspector-Token": token };
}
export async function request<T>(route: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(
    `/api/${route}${route.includes("?") ? "&" : "?"}generation=${encodeURIComponent(generation)}`,
    { headers: headers(), signal, cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      response.status === 409 || response.status === 401
        ? "Session expired; open a new viewer from Pi."
        : "Viewer unavailable; reconnecting requires a running Pi session.",
    );
  return response.json() as Promise<T>;
}
interface Job {
  signal: AbortSignal;
  run(): Promise<void>;
  cancel(): void;
}
const queue: Job[] = [];
const cache = new Map<string, DetailView>();
let active = 0;
function pump(): void {
  while (active < 4 && queue.length) {
    const job = queue.shift();
    if (!job || job.signal.aborted) continue;
    active++;
    void job.run().finally(() => {
      active--;
      pump();
    });
  }
}
function loadDetail(id: string, signal: AbortSignal): Promise<DetailView> {
  signal.throwIfAborted();
  const cached = cache.get(id);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const job: Job = {
      signal,
      cancel: () => {
        const index = queue.indexOf(job);
        if (index !== -1) queue.splice(index, 1);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      run: async () => {
        try {
          const value = await request<DetailView>(
            `detail?id=${encodeURIComponent(id)}&leaf=${encodeURIComponent(id)}`,
            signal,
          );
          if (signal.aborted) return;
          // Raw entries and their own historical projection are immutable; live calls use the latest snapshot.
          const result = cache.get(id) ?? { ...value, calls: [] };
          cache.set(id, result);
          while (cache.size > 64) {
            const first = cache.keys().next().value;
            if (first === undefined) break;
            cache.delete(first);
          }
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          signal.removeEventListener("abort", job.cancel);
        }
      },
    };
    signal.addEventListener("abort", job.cancel, { once: true });
    queue.push(job);
    pump();
  });
}
export function useDetail(id: string | undefined): { detail?: DetailView; error: string } {
  const [state, setState] = useState<{ id?: string; detail?: DetailView; error: string }>({ error: "" });
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void loadDetail(id, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) setState({ id, detail, error: "" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ id, error: "Could not load entry details." });
      });
    return () => controller.abort();
  }, [id]);
  return state.id === id ? state : { error: "" };
}
