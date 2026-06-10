import { RED, RESET } from "../output.js"

// On directory change the hook:
//   1. dedups on the resolved config path (no-op when cd stays inside the same package),
//   2. restores the previously-injected package (prior values, not blind unset),
//   3. injects the new directory's package via `env export --track` (scope="shell" only),
//   4. prints a credential-health warning via `audit`.
// `envpkt config-path` is resolve-only (no decrypt), so the per-cd gate is cheap. Only the
// `env export` step decrypts, and only when the resolved package actually changed.
//
// In these template literals, only `\${...}` brace-expansions and backticks are escaped — every
// other `$` (`$k`, `$cfg`, `$(...)`) is literal shell and needs no escape.

const ZSH_HOOK = `# envpkt shell hook — add to ~/.zshrc:  eval "$(envpkt shell-hook zsh)"
# Loads a project envpkt.toml on cd (secrets only for scope="shell" packages), restores the
# prior environment on leave, and warns on credential health. Use \`envpkt exec\` for scope="exec".
_envpkt_restore() {
  [[ -n "$_ENVPKT_INJECTED" ]] || return
  local k had prev
  for k in \${(s: :)_ENVPKT_INJECTED}; do
    had="_ENVPKT_HAD_$k"
    prev="_ENVPKT_PREV_$k"
    if [[ -n "\${(P)had}" ]]; then
      export "$k=\${(P)prev}"
    else
      unset "$k"
    fi
    unset "$had" "$prev"
  done
  unset _ENVPKT_INJECTED
}

_envpkt_chpwd() {
  local cfg
  cfg="$(envpkt config-path 2>/dev/null)"
  [[ "$cfg" == "$_ENVPKT_DIR" ]] && return
  _envpkt_restore
  _ENVPKT_DIR="$cfg"
  [[ -z "$cfg" ]] && return
  eval "$(envpkt env export --track 2>/dev/null)"
  envpkt audit --format minimal 2>/dev/null
}

autoload -Uz add-zsh-hook
add-zsh-hook chpwd _envpkt_chpwd
_envpkt_chpwd
`

const BASH_HOOK = `# envpkt shell hook — add to ~/.bashrc:  eval "$(envpkt shell-hook bash)"
# Loads a project envpkt.toml on cd (secrets only for scope="shell" packages), restores the
# prior environment on leave, and warns on credential health. Use \`envpkt exec\` for scope="exec".
_envpkt_restore() {
  [ -n "$_ENVPKT_INJECTED" ] || return
  local k had prev
  for k in $_ENVPKT_INJECTED; do
    had="_ENVPKT_HAD_$k"
    prev="_ENVPKT_PREV_$k"
    if [ -n "\${!had}" ]; then
      export "$k=\${!prev}"
    else
      unset "$k"
    fi
    unset "$had" "$prev"
  done
  unset _ENVPKT_INJECTED
}

_envpkt_prompt() {
  [ "$PWD" = "$_ENVPKT_PWD" ] && return
  _ENVPKT_PWD="$PWD"
  local cfg
  cfg="$(envpkt config-path 2>/dev/null)"
  [ "$cfg" = "$_ENVPKT_DIR" ] && return
  _envpkt_restore
  _ENVPKT_DIR="$cfg"
  [ -z "$cfg" ] && return
  eval "$(envpkt env export --track 2>/dev/null)"
  envpkt audit --format minimal 2>/dev/null
}

case "$PROMPT_COMMAND" in
  *_envpkt_prompt*) ;;
  *) PROMPT_COMMAND="_envpkt_prompt\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac
_envpkt_prompt
`

export const runShellHook = (shell: string): void => {
  switch (shell) {
    case "zsh":
      console.log(ZSH_HOOK)
      break
    case "bash":
      console.log(BASH_HOOK)
      break
    default:
      console.error(`${RED}Error:${RESET} Unsupported shell: ${shell}. Use "zsh" or "bash".`)
      process.exit(1)
  }
}
