import { bindings, defineConfig } from "cf/config";

export default defineConfig(({ mode, isPreview }) => {
  if (isPreview) throw new Error("Remote previews are disabled for this project.");
  if (mode !== undefined && mode !== "read-only" && mode !== "invite") {
    throw new Error("Use the default, read-only, or invite mode.");
  }
  const invite = mode === "invite";
  const databaseId = process.env.T1D_CLOUDFLARE_D1_ID;
  if (invite && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId ?? "")) {
    throw new Error("Invite mode requires T1D_CLOUDFLARE_D1_ID for an existing, verified Workers Free database.");
  }
  return {
    worker: {
      name: "t1d-open-desk",
      entrypoint: "./bundle/index.mjs",
      compatibilityDate: "2026-11-24",
      workersDev: true,
      previewUrls: false,
      observability: { enabled: false },
      assets: { runWorkerFirst: ["/api/*"] },
      env: {
        ASSETS: bindings.assets(),
        OPEN_DESK_MODE: bindings.text(invite ? "invite" : "read-only"),
        ...(invite ? { DB: bindings.d1({ id: databaseId, name: "t1d-open-desk" }) } : {}),
      },
    },
  };
});
