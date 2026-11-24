// cf uses Wrangler as a local bundler; deployment and resource operations use cf.
import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  assetsDirectory: "./public",
  uploadSourceMaps: false,
  types: { generate: false },
});
