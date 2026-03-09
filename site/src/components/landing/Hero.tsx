import { useState } from "react"

export default function Hero() {
  const [copied, setCopied] = useState(false)

  const copyInstall = () => {
    navigator.clipboard.writeText("npm install envpkt")
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section id="home" className="px-6 py-20 max-w-7xl mx-auto">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <button
            onClick={copyInstall}
            className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-full text-sm font-mono text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            <span>npm install envpkt</span>
            {copied ? (
              <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            )}
          </button>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight">
            Credentials your agents <span className="text-emerald-600 dark:text-emerald-400">actually understand</span>
          </h1>

          <p className="text-lg md:text-xl text-zinc-600 dark:text-zinc-400 max-w-xl">
            Structured metadata for every secret — capabilities, constraints, expiration, and fleet health — so agents
            operate within their boundaries instead of flying blind.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <a
              href="/getting-started/installation/"
              className="inline-block px-8 py-3 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors text-center"
            >
              Get Started
            </a>
            <a
              href="/getting-started/quick-start/"
              className="inline-block px-8 py-3 bg-transparent text-emerald-600 dark:text-emerald-400 font-semibold rounded-lg border-2 border-emerald-600 dark:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors text-center"
            >
              Documentation
            </a>
            <a
              href="https://github.com/jordanburke/envpkt"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-8 py-3 text-zinc-700 dark:text-zinc-300 font-semibold rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-center"
            >
              GitHub
            </a>
          </div>

          <div className="flex flex-wrap gap-6 pt-6 text-center">
            <div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">45+</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">Credential Patterns</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">age-encrypted</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">Sealed Secrets</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">MCP-native</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">Agent Integration</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">Zero</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">Thrown Exceptions</div>
            </div>
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="bg-zinc-900 dark:bg-zinc-950 rounded-xl shadow-2xl overflow-hidden border border-zinc-700">
            <div className="flex items-center gap-2 px-4 py-3 bg-zinc-800 dark:bg-zinc-900 border-b border-zinc-700">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="ml-2 text-xs text-zinc-400 font-mono">terminal</span>
            </div>
            <div className="p-6 font-mono text-sm leading-relaxed">
              <div className="text-zinc-400">$ npx envpkt init</div>
              <div className="text-emerald-400 mt-1">Created envpkt.toml with 2 secrets</div>
              <div className="mt-3 text-zinc-400">$ npx envpkt env scan</div>
              <div className="text-emerald-400 mt-1">Found 12 credentials in environment</div>
              <div className="text-yellow-400"> OPENAI_API_KEY ........... high confidence</div>
              <div className="text-yellow-400"> STRIPE_SECRET_KEY ....... high confidence</div>
              <div className="text-yellow-400"> DATABASE_URL ............ high confidence</div>
              <div className="text-zinc-500"> ... 9 more</div>
              <div className="mt-3 text-zinc-400">$ npx envpkt audit</div>
              <div className="text-emerald-400 mt-1">All 12 secrets healthy</div>
              <div className="mt-3 text-zinc-400">$ npx envpkt seal</div>
              <div className="text-emerald-400 mt-1">Sealed 12 secrets with age encryption</div>
              <div className="mt-3 text-zinc-400">$ npx envpkt exec -- node app.js</div>
              <div className="text-emerald-400 mt-1">Injected 12 secrets into process</div>
              <div className="text-blue-400">Server running on :3000</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
