const features = [
  {
    title: "Developer Workflow",
    description:
      'Scan your environment, build a catalog, sync via cloud drive, and load secrets per terminal with eval "$(envpkt env export)".',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
    href: "/guides/developer-workflow/",
  },
  {
    title: "Agent & CI Deployment",
    description:
      "Gate deployments with audit --strict, encrypt with seal, deploy with exec --strict, and monitor with fleet.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    href: "/guides/agent-ci-workflow/",
  },
  {
    title: "MCP Integration",
    description:
      "Built-in MCP server gives AI agents structured awareness of their credentials without exposing secret values. Works with Claude, Cursor, VS Code.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"
        />
      </svg>
    ),
    href: "/integrations/mcp-server/",
  },
  {
    title: "Three-Tier Security",
    description:
      "Architecturally enforced trust boundaries. MCP server never accesses secret values. Runtime injection stays outside the LLM context. Fleet-wide audit trails.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
      </svg>
    ),
    href: "/getting-started/quick-start/",
  },
  {
    title: "Metadata + Sealed Secrets",
    description:
      "Every credential gets structured metadata — service, purpose, capabilities, expiration, rotation URL — plus optional age-encrypted sealed packets, safe to commit to git.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      </svg>
    ),
    href: "/getting-started/the-toml-file/",
  },
  {
    title: "Environment Scanning",
    description:
      "Auto-discover credentials from your shell with envpkt env scan. Matches ~45 known services, ~13 suffix patterns, and ~29 value shapes with confidence scoring.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    ),
    href: "/guides/environment-scanning/",
  },
  {
    title: "Fleet Health",
    description:
      "Scan an entire directory tree of agents with envpkt fleet. Get aggregated health status, expiration warnings, and stale credential detection.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
    ),
    href: "/guides/fleet-management/",
  },
  {
    title: "Functional API",
    description:
      "TypeScript library built on functype. All functions return Either or Option — no thrown exceptions. Use programmatically for boot, audit, fleet scan, and more.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
    href: "/reference/library-api/",
  },
]

export default function Features() {
  return (
    <section id="features" className="px-6 py-20 bg-white dark:bg-zinc-900">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-4xl font-bold text-center text-zinc-900 dark:text-zinc-50 mb-4">What envpkt does</h2>
        <p className="text-xl text-zinc-600 dark:text-zinc-400 text-center mb-16 max-w-3xl mx-auto">
          A metadata sidecar that gives AI agents and CI pipelines structured awareness of their secrets
        </p>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature) => (
            <a
              key={feature.title}
              href={feature.href}
              className="block p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-emerald-500 dark:hover:border-emerald-500 transition-colors group"
            >
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center mb-4 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/50 transition-colors">
                {feature.icon}
              </div>
              <h3 className="text-lg font-semibold mb-2 text-zinc-900 dark:text-zinc-50">{feature.title}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{feature.description}</p>
            </a>
          ))}
        </div>

        <div className="mt-16">
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-800 rounded-2xl p-8 md:p-12 text-center text-white shadow-xl">
            <div className="flex justify-center mb-4">
              <svg className="w-16 h-16 text-white opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"
                />
              </svg>
            </div>
            <h3 className="text-3xl md:text-4xl font-bold mb-4">Built for MCP</h3>
            <p className="text-xl text-emerald-100 mb-8 max-w-2xl mx-auto">
              The only credential manager with a native MCP server. Your AI agents can check credential health,
              capabilities, and expiration — without ever seeing a secret value.
            </p>
            <a
              href="/integrations/mcp-server/"
              className="inline-block px-8 py-4 bg-white text-emerald-700 rounded-lg font-semibold text-lg hover:bg-emerald-50 transition-colors shadow-lg hover:shadow-xl"
            >
              Learn about MCP Integration
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
