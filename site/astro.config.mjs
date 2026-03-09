import starlight from "@astrojs/starlight"
import react from "@astrojs/react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

export default defineConfig({
  site: "https://envpkt.dev",
  integrations: [
    starlight({
      title: "envpacket / envpkt",
      description: "Credential lifecycle and fleet management for General Env and AI agents",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/jordanburke/envpkt" }],
      components: {
        SiteTitle: "./src/components/starlight/SiteTitle.astro",
      },
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
            { slug: "cli/keygen" },
            { slug: "cli/audit" },
            { slug: "cli/inspect" },
            { slug: "cli/resolve" },
            { slug: "cli/fleet" },
            { slug: "cli/exec" },
            { slug: "cli/env-scan" },
            { slug: "cli/env-check" },
            { slug: "cli/env-export" },
            { slug: "cli/shell-hook" },
            { slug: "cli/mcp" },
          ],
        },
        {
          label: "Guides",
          items: [
            { slug: "guides/developer-workflow" },
            { slug: "guides/agent-ci-workflow" },
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
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ["postcss", "nanoid"],
    },
  },
})
