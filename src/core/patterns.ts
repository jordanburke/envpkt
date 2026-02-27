import { Option } from "functype"

// --- Types ---

export type ConfidenceLevel = "high" | "medium" | "low"

export type CredentialPattern = {
  readonly kind: "name" | "prefix" | "suffix" | "value_prefix" | "value_regex"
  readonly pattern: string
  readonly service: string
  readonly confidence: ConfidenceLevel
  readonly description: string
}

export type MatchResult = {
  readonly envVar: string
  readonly value: string
  readonly service: Option<string>
  readonly confidence: ConfidenceLevel
  readonly matchedBy: string
}

// --- Exclusion set: env vars that are never credentials ---

const EXCLUDED_VARS = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "DISPLAY",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "HOSTNAME",
  "LOGNAME",
  "MAIL",
  "OLDPWD",
  "PWD",
  "SHLVL",
  "TMPDIR",
  "TZ",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
  "NODE_ENV",
  "NODE_PATH",
  "NODE_OPTIONS",
  "NVM_DIR",
  "NVM_BIN",
  "NVM_INC",
  "NVM_CD_FLAGS",
  "NPM_CONFIG_PREFIX",
  "GOPATH",
  "GOROOT",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "JAVA_HOME",
  "ANDROID_HOME",
  "PYENV_ROOT",
  "VIRTUAL_ENV",
  "CONDA_PREFIX",
  "CONDA_DEFAULT_ENV",
  "MANPATH",
  "INFOPATH",
  "LESS",
  "LSCOLORS",
  "LS_COLORS",
  "COLORTERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
  "ITERM_SESSION_ID",
  "ITERM_PROFILE",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "GPG_TTY",
  "GNUPGHOME",
  "DBUS_SESSION_BUS_ADDRESS",
  "WAYLAND_DISPLAY",
  "ZDOTDIR",
  "ZSH",
  "HISTFILE",
  "HISTSIZE",
  "SAVEHIST",
  "_",
  "__CF_USER_TEXT_ENCODING",
  "Apple_PubSub_Socket_Render",
  "COMMAND_MODE",
  "SECURITYSESSIONID",
  "LaunchInstanceID",
  "PNPM_HOME",
  "BUN_INSTALL",
  "FNM_DIR",
  "FNM_MULTISHELL_PATH",
  "FNM_VERSION_FILE_STRATEGY",
  "FNM_LOGLEVEL",
  "FNM_NODE_DIST_MIRROR",
  "FNM_ARCH",
  "VOLTA_HOME",
])

// --- Exact name patterns (high confidence) ---

const EXACT_NAME_PATTERNS: ReadonlyArray<CredentialPattern> = [
  // OpenAI
  { kind: "name", pattern: "OPENAI_API_KEY", service: "openai", confidence: "high", description: "OpenAI API key" },
  { kind: "name", pattern: "OPENAI_ORG_ID", service: "openai", confidence: "high", description: "OpenAI org ID" },
  // Anthropic
  {
    kind: "name",
    pattern: "ANTHROPIC_API_KEY",
    service: "anthropic",
    confidence: "high",
    description: "Anthropic API key",
  },
  // AWS
  {
    kind: "name",
    pattern: "AWS_ACCESS_KEY_ID",
    service: "aws",
    confidence: "high",
    description: "AWS access key ID",
  },
  {
    kind: "name",
    pattern: "AWS_SECRET_ACCESS_KEY",
    service: "aws",
    confidence: "high",
    description: "AWS secret access key",
  },
  {
    kind: "name",
    pattern: "AWS_SESSION_TOKEN",
    service: "aws",
    confidence: "high",
    description: "AWS session token",
  },
  // Google Cloud
  {
    kind: "name",
    pattern: "GOOGLE_APPLICATION_CREDENTIALS",
    service: "gcp",
    confidence: "high",
    description: "Google Cloud service account path",
  },
  {
    kind: "name",
    pattern: "GOOGLE_API_KEY",
    service: "google",
    confidence: "high",
    description: "Google API key",
  },
  {
    kind: "name",
    pattern: "GCP_PROJECT_ID",
    service: "gcp",
    confidence: "medium",
    description: "GCP project ID",
  },
  // Azure
  {
    kind: "name",
    pattern: "AZURE_CLIENT_ID",
    service: "azure",
    confidence: "high",
    description: "Azure client ID",
  },
  {
    kind: "name",
    pattern: "AZURE_CLIENT_SECRET",
    service: "azure",
    confidence: "high",
    description: "Azure client secret",
  },
  {
    kind: "name",
    pattern: "AZURE_TENANT_ID",
    service: "azure",
    confidence: "high",
    description: "Azure tenant ID",
  },
  // Stripe
  {
    kind: "name",
    pattern: "STRIPE_SECRET_KEY",
    service: "stripe",
    confidence: "high",
    description: "Stripe secret key",
  },
  {
    kind: "name",
    pattern: "STRIPE_PUBLISHABLE_KEY",
    service: "stripe",
    confidence: "high",
    description: "Stripe publishable key",
  },
  {
    kind: "name",
    pattern: "STRIPE_WEBHOOK_SECRET",
    service: "stripe",
    confidence: "high",
    description: "Stripe webhook secret",
  },
  // GitHub
  { kind: "name", pattern: "GITHUB_TOKEN", service: "github", confidence: "high", description: "GitHub token" },
  {
    kind: "name",
    pattern: "GH_TOKEN",
    service: "github",
    confidence: "high",
    description: "GitHub token (gh CLI)",
  },
  // Slack
  {
    kind: "name",
    pattern: "SLACK_BOT_TOKEN",
    service: "slack",
    confidence: "high",
    description: "Slack bot token",
  },
  {
    kind: "name",
    pattern: "SLACK_SIGNING_SECRET",
    service: "slack",
    confidence: "high",
    description: "Slack signing secret",
  },
  {
    kind: "name",
    pattern: "SLACK_WEBHOOK_URL",
    service: "slack",
    confidence: "high",
    description: "Slack webhook URL",
  },
  // Twilio
  {
    kind: "name",
    pattern: "TWILIO_ACCOUNT_SID",
    service: "twilio",
    confidence: "high",
    description: "Twilio account SID",
  },
  {
    kind: "name",
    pattern: "TWILIO_AUTH_TOKEN",
    service: "twilio",
    confidence: "high",
    description: "Twilio auth token",
  },
  // SendGrid
  {
    kind: "name",
    pattern: "SENDGRID_API_KEY",
    service: "sendgrid",
    confidence: "high",
    description: "SendGrid API key",
  },
  // Supabase
  {
    kind: "name",
    pattern: "SUPABASE_URL",
    service: "supabase",
    confidence: "high",
    description: "Supabase project URL",
  },
  {
    kind: "name",
    pattern: "SUPABASE_ANON_KEY",
    service: "supabase",
    confidence: "high",
    description: "Supabase anon key",
  },
  {
    kind: "name",
    pattern: "SUPABASE_SERVICE_ROLE_KEY",
    service: "supabase",
    confidence: "high",
    description: "Supabase service role key",
  },
  // Database
  { kind: "name", pattern: "DATABASE_URL", service: "database", confidence: "high", description: "Database URL" },
  {
    kind: "name",
    pattern: "DATABASE_PASSWORD",
    service: "database",
    confidence: "high",
    description: "Database password",
  },
  { kind: "name", pattern: "REDIS_URL", service: "redis", confidence: "high", description: "Redis URL" },
  { kind: "name", pattern: "MONGODB_URI", service: "mongodb", confidence: "high", description: "MongoDB URI" },
  // Datadog
  {
    kind: "name",
    pattern: "DD_API_KEY",
    service: "datadog",
    confidence: "high",
    description: "Datadog API key",
  },
  {
    kind: "name",
    pattern: "DD_APP_KEY",
    service: "datadog",
    confidence: "high",
    description: "Datadog app key",
  },
  // Sentry
  { kind: "name", pattern: "SENTRY_DSN", service: "sentry", confidence: "high", description: "Sentry DSN" },
  {
    kind: "name",
    pattern: "SENTRY_AUTH_TOKEN",
    service: "sentry",
    confidence: "high",
    description: "Sentry auth token",
  },
  // Vercel
  { kind: "name", pattern: "VERCEL_TOKEN", service: "vercel", confidence: "high", description: "Vercel token" },
  // Netlify
  {
    kind: "name",
    pattern: "NETLIFY_AUTH_TOKEN",
    service: "netlify",
    confidence: "high",
    description: "Netlify auth token",
  },
  // Cloudflare
  {
    kind: "name",
    pattern: "CLOUDFLARE_API_TOKEN",
    service: "cloudflare",
    confidence: "high",
    description: "Cloudflare API token",
  },
  {
    kind: "name",
    pattern: "CF_API_TOKEN",
    service: "cloudflare",
    confidence: "high",
    description: "Cloudflare API token",
  },
  // Docker
  {
    kind: "name",
    pattern: "DOCKER_PASSWORD",
    service: "docker",
    confidence: "high",
    description: "Docker password",
  },
  {
    kind: "name",
    pattern: "DOCKER_TOKEN",
    service: "docker",
    confidence: "high",
    description: "Docker token",
  },
  // NPM
  { kind: "name", pattern: "NPM_TOKEN", service: "npm", confidence: "high", description: "npm token" },
  // Hugging Face
  { kind: "name", pattern: "HF_TOKEN", service: "huggingface", confidence: "high", description: "Hugging Face token" },
  {
    kind: "name",
    pattern: "HUGGING_FACE_HUB_TOKEN",
    service: "huggingface",
    confidence: "high",
    description: "Hugging Face Hub token",
  },
  // Cohere
  {
    kind: "name",
    pattern: "COHERE_API_KEY",
    service: "cohere",
    confidence: "high",
    description: "Cohere API key",
  },
  // Replicate
  {
    kind: "name",
    pattern: "REPLICATE_API_TOKEN",
    service: "replicate",
    confidence: "high",
    description: "Replicate API token",
  },
  // Pinecone
  {
    kind: "name",
    pattern: "PINECONE_API_KEY",
    service: "pinecone",
    confidence: "high",
    description: "Pinecone API key",
  },
  // Linear
  {
    kind: "name",
    pattern: "LINEAR_API_KEY",
    service: "linear",
    confidence: "high",
    description: "Linear API key",
  },
]

// --- Generic suffix patterns (medium confidence) ---

const SUFFIX_PATTERNS: ReadonlyArray<{ suffix: string; description: string }> = [
  { suffix: "_API_KEY", description: "API key" },
  { suffix: "_SECRET_KEY", description: "Secret key" },
  { suffix: "_SECRET", description: "Secret" },
  { suffix: "_TOKEN", description: "Token" },
  { suffix: "_PASSWORD", description: "Password" },
  { suffix: "_PASS", description: "Password" },
  { suffix: "_AUTH_TOKEN", description: "Auth token" },
  { suffix: "_ACCESS_TOKEN", description: "Access token" },
  { suffix: "_PRIVATE_KEY", description: "Private key" },
  { suffix: "_SIGNING_KEY", description: "Signing key" },
  { suffix: "_WEBHOOK_SECRET", description: "Webhook secret" },
  { suffix: "_DSN", description: "DSN" },
  { suffix: "_CONNECTION_STRING", description: "Connection string" },
]

// --- Value shape patterns ---

type ValuePattern = {
  readonly prefix: string
  readonly service: string
  readonly description: string
}

const VALUE_SHAPE_PATTERNS: ReadonlyArray<ValuePattern> = [
  { prefix: "sk-ant-", service: "anthropic", description: "Anthropic API key" },
  { prefix: "sk-", service: "openai", description: "OpenAI API key" },
  { prefix: "sk_live_", service: "stripe", description: "Stripe live secret key" },
  { prefix: "sk_test_", service: "stripe", description: "Stripe test secret key" },
  { prefix: "pk_live_", service: "stripe", description: "Stripe live publishable key" },
  { prefix: "pk_test_", service: "stripe", description: "Stripe test publishable key" },
  { prefix: "whsec_", service: "stripe", description: "Stripe webhook secret" },
  { prefix: "AKIA", service: "aws", description: "AWS access key ID" },
  { prefix: "ghp_", service: "github", description: "GitHub personal access token" },
  { prefix: "gho_", service: "github", description: "GitHub OAuth token" },
  { prefix: "ghs_", service: "github", description: "GitHub server-to-server token" },
  { prefix: "ghu_", service: "github", description: "GitHub user-to-server token" },
  { prefix: "github_pat_", service: "github", description: "GitHub fine-grained PAT" },
  { prefix: "xoxb-", service: "slack", description: "Slack bot token" },
  { prefix: "xoxp-", service: "slack", description: "Slack user token" },
  { prefix: "xoxa-", service: "slack", description: "Slack app token" },
  { prefix: "xoxs-", service: "slack", description: "Slack legacy token" },
  { prefix: "SG.", service: "sendgrid", description: "SendGrid API key" },
  { prefix: "hf_", service: "huggingface", description: "Hugging Face token" },
  { prefix: "r8_", service: "replicate", description: "Replicate API token" },
  { prefix: "eyJ", service: "jwt", description: "JWT token" },
  { prefix: "postgres://", service: "postgresql", description: "PostgreSQL connection string" },
  { prefix: "postgresql://", service: "postgresql", description: "PostgreSQL connection string" },
  { prefix: "mysql://", service: "mysql", description: "MySQL connection string" },
  { prefix: "mongodb://", service: "mongodb", description: "MongoDB connection string" },
  { prefix: "mongodb+srv://", service: "mongodb", description: "MongoDB SRV connection string" },
  { prefix: "redis://", service: "redis", description: "Redis connection string" },
  { prefix: "rediss://", service: "redis", description: "Redis TLS connection string" },
  { prefix: "amqp://", service: "rabbitmq", description: "RabbitMQ connection string" },
  { prefix: "amqps://", service: "rabbitmq", description: "RabbitMQ TLS connection string" },
]

// --- Core matching functions ---

/** Detect service from value prefix/shape */
export const matchValueShape = (value: string): Option<{ service: string; description: string }> => {
  for (const vp of VALUE_SHAPE_PATTERNS) {
    if (value.startsWith(vp.prefix)) {
      return Option({ service: vp.service, description: vp.description })
    }
  }
  return Option<{ service: string; description: string }>(undefined)
}

/** Strip common suffixes and derive a service name from an env var name */
export const deriveServiceFromName = (name: string): string => {
  const suffixes = [
    "_API_KEY",
    "_SECRET_KEY",
    "_ACCESS_KEY",
    "_PRIVATE_KEY",
    "_SIGNING_KEY",
    "_AUTH_TOKEN",
    "_ACCESS_TOKEN",
    "_WEBHOOK_SECRET",
    "_CONNECTION_STRING",
    "_SECRET",
    "_TOKEN",
    "_PASSWORD",
    "_PASS",
    "_KEY",
    "_DSN",
    "_URL",
    "_URI",
  ]

  let stripped = name
  for (const suffix of suffixes) {
    if (stripped.endsWith(suffix)) {
      stripped = stripped.slice(0, -suffix.length)
      break
    }
  }

  return stripped.toLowerCase().replace(/_/g, "-")
}

/** Match a single env var against all patterns */
export const matchEnvVar = (name: string, value: string): Option<MatchResult> => {
  if (EXCLUDED_VARS.has(name)) return Option<MatchResult>(undefined)

  // Layer 1: Exact name match (high confidence)
  for (const p of EXACT_NAME_PATTERNS) {
    if (name === p.pattern) {
      return Option<MatchResult>({
        envVar: name,
        value,
        service: Option(p.service),
        confidence: p.confidence,
        matchedBy: `exact:${p.pattern}`,
      })
    }
  }

  // Layer 2: Value shape match (high confidence — service from value, not name)
  return matchValueShape(value).fold(
    () => {
      // Layer 3: Generic suffix match (medium confidence)
      for (const sp of SUFFIX_PATTERNS) {
        if (name.endsWith(sp.suffix)) {
          return Option<MatchResult>({
            envVar: name,
            value,
            service: Option(deriveServiceFromName(name)),
            confidence: "medium",
            matchedBy: `suffix:${sp.suffix}`,
          })
        }
      }
      return Option<MatchResult>(undefined)
    },
    (vm) =>
      Option<MatchResult>({
        envVar: name,
        value,
        service: Option(vm.service),
        confidence: "high",
        matchedBy: `value:${vm.description}`,
      }),
  )
}

/** Scan full env, sorted by confidence (high first) then alphabetically */
export const scanEnv = (env: Readonly<Record<string, string | undefined>>): ReadonlyArray<MatchResult> => {
  const results: MatchResult[] = []

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value === "") continue
    matchEnvVar(name, value).fold(
      () => {},
      (m) => results.push(m),
    )
  }

  const confidenceOrder: Record<ConfidenceLevel, number> = { high: 0, medium: 1, low: 2 }

  results.sort((a, b) => {
    const conf = confidenceOrder[a.confidence] - confidenceOrder[b.confidence]
    if (conf !== 0) return conf
    return a.envVar.localeCompare(b.envVar)
  })

  return results
}
