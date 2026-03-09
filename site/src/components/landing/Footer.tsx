export default function Footer() {
  return (
    <footer className="bg-zinc-900 dark:bg-zinc-950 text-zinc-400 px-6 py-12">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div>
            <h3 className="text-white font-semibold text-lg mb-4" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              envpkt
            </h3>
            <p className="text-sm">Credentials your agents actually understand</p>
            <div className="mt-4 flex gap-2">
              <img src="https://img.shields.io/npm/v/envpkt?style=flat-square" alt="npm version" className="h-5" />
            </div>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Documentation</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="/getting-started/installation/" className="hover:text-white transition-colors">
                  Installation
                </a>
              </li>
              <li>
                <a href="/getting-started/quick-start/" className="hover:text-white transition-colors">
                  Quick Start
                </a>
              </li>
              <li>
                <a href="/getting-started/the-toml-file/" className="hover:text-white transition-colors">
                  The TOML File
                </a>
              </li>
              <li>
                <a href="/cli/" className="hover:text-white transition-colors">
                  CLI Reference
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Integrations</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="/integrations/mcp-server/" className="hover:text-white transition-colors">
                  MCP Server
                </a>
              </li>
              <li>
                <a href="/integrations/fnox/" className="hover:text-white transition-colors">
                  fnox
                </a>
              </li>
              <li>
                <a href="/integrations/shell-hooks/" className="hover:text-white transition-colors">
                  Shell Hooks
                </a>
              </li>
              <li>
                <a href="/guides/ci-cd/" className="hover:text-white transition-colors">
                  CI/CD
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Community</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="https://github.com/jordanburke/envpkt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://www.npmjs.com/package/envpkt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  npm Package
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/jordanburke/envpkt/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  Issues
                </a>
              </li>
              <li>
                <a href="/reference/library-api/" className="hover:text-white transition-colors">
                  Library API
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm">MIT License</p>
          <div className="flex gap-4 text-sm">
            <a
              href="https://github.com/jordanburke"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              @jordanburke
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
