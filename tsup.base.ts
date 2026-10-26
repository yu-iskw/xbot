import { defineConfig, type Options } from "tsup";

const common: Options = { format: ["esm"], sourcemap: true, target: "node22" };

/** Build config shared by every published package: a typed library entry, plus an optional CLI binary. */
export function definePackage({ bin = false }: { bin?: boolean } = {}) {
  const lib: Options = { ...common, entry: ["src/index.ts"], dts: true, clean: true };
  const binary: Options = { ...common, entry: ["src/bin.ts"], banner: { js: "#!/usr/bin/env node" } };
  return defineConfig(bin ? [lib, binary] : [lib]);
}
