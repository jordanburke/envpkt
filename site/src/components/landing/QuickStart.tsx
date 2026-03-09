const steps = [
  {
    num: 1,
    title: "Install",
    code: "npm install envpkt",
    note: "Also works with yarn, pnpm, and bun",
  },
  {
    num: 2,
    title: "Initialize",
    code: "npx envpkt init",
    note: "Creates envpkt.toml with your project's secrets",
  },
  {
    num: 3,
    title: "Scan",
    code: "npx envpkt env scan",
    note: "Auto-discover credentials from your environment",
  },
  {
    num: 4,
    title: "Audit",
    code: "npx envpkt audit",
    note: "Check health, expiration, and lifecycle status",
  },
  {
    num: 5,
    title: "Seal & Deploy",
    code: "npx envpkt seal && npx envpkt exec -- node app.js",
    note: "Encrypt secrets with age, then inject at runtime",
  },
]

export default function QuickStart() {
  return (
    <section id="quick-start" className="px-6 py-20 bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-4xl font-bold text-center text-zinc-900 dark:text-zinc-50 mb-4">Quick Start</h2>
        <p className="text-xl text-zinc-600 dark:text-zinc-400 text-center mb-12">
          From install to sealed deployment in 5 steps
        </p>

        <div className="space-y-6">
          {steps.map((step) => (
            <div
              key={step.num}
              className="bg-white dark:bg-zinc-900 rounded-xl p-6 md:p-8 shadow-sm border border-zinc-200 dark:border-zinc-800"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-emerald-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                  {step.num}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold mb-3 text-zinc-900 dark:text-zinc-50">{step.title}</h3>
                  <div className="bg-zinc-900 dark:bg-zinc-950 rounded-lg p-4 overflow-x-auto">
                    <code className="text-emerald-400 font-mono text-sm">{step.code}</code>
                  </div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">{step.note}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center space-y-4">
          <p className="text-lg text-zinc-600 dark:text-zinc-400">Ready to learn more?</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/getting-started/installation/"
              className="inline-block px-6 py-3 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors"
            >
              Full Documentation
            </a>
            <a
              href="/guides/developer-workflow/"
              className="inline-block px-6 py-3 bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 font-semibold rounded-lg border-2 border-emerald-600 dark:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
            >
              Developer Workflow Guide
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
