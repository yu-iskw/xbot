import { createXbotRuntime, type XbotConfig } from "../src/index";

export const FIXED_NOW = new Date("2026-10-26T09:00:00.000Z");
export const fixedNow = () => FIXED_NOW;

export function memoryRuntime(config: XbotConfig = {}) {
  return createXbotRuntime({ storage: { url: ":memory:" }, now: fixedNow, x: { mode: "mock" }, ...config });
}
