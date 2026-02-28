import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"

export default defineConfig({
  integrations: [
    starlight({
      title: "envpkt",
      description: "Credential lifecycle and fleet management for AI agents",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/jordanburke/envpkt" }],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { slug: "getting-started/installation" },
            { slug: "getting-started/quick-start" },
            { slug: "getting-started/the-toml-file" },
          ],
        },
        {
          label: "CLI Reference",
          items: [
            { slug: "cli" },
            { slug: "cli/init" },
            { slug: "cli/audit" },
            { slug: "cli/inspect" },
            { slug: "cli/resolve" },
            { slug: "cli/fleet" },
            { slug: "cli/exec" },
            { slug: "cli/env-scan" },
            { slug: "cli/env-check" },
            { slug: "cli/shell-hook" },
            { slug: "cli/mcp" },
          ],
        },
        {
          label: "Guides",
          items: [
            { slug: "guides/catalog-system" },
            { slug: "guides/fleet-management" },
            { slug: "guides/environment-scanning" },
            { slug: "guides/ci-cd" },
          ],
        },
        {
          label: "Integrations",
          items: [
            { slug: "integrations/fnox" },
            { slug: "integrations/mcp-server" },
            { slug: "integrations/shell-hooks" },
          ],
        },
        {
          label: "Reference",
          items: [
            { slug: "reference/toml-schema" },
            { slug: "reference/library-api" },
            { slug: "reference/error-types" },
            { slug: "reference/exit-codes" },
          ],
        },
        {
          label: "Examples",
          autogenerate: { directory: "examples" },
        },
      ],
    }),
  ],
  vite: {
    ssr: {
      noExternal: ["postcss", "nanoid"],
    },
  },
})
