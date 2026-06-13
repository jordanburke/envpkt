import { RED, RESET } from "../output.js"

type ShellHookOptions = {
  readonly audit?: boolean
}

// The hook, on each directory change:
//   1. dedups on the resolved config path (no-op when cd stays inside the same package),
//   2. restores the previously-injected package (prior values, not blind unset),
//   3. injects the new directory's package via `env export --track` (scope="shell" secrets only),
//   4. optionally prints a credential-health warning via `audit` (omit with --no-audit).
//
// `env export --track` is quiet on success and prints only hard errors (e.g. a missing seal key)
// to stderr — so the inject is NOT stderr-suppressed here, letting those errors surface on cd.
// `config-path`/`audit` ARE stderr-suppressed (resolve-only / health noise).
//
// Built from single-quoted line arrays so `$`, `${...}` and `"` are all literal shell — no escaping.

const zshHook = (audit: boolean): string =>
  [
    '# envpkt shell hook — add to ~/.zshrc:  eval "$(envpkt shell-hook zsh)"',
    "# Loads the current directory package on cd, restores the prior env on leave, warns on health.",
    "_envpkt_restore() {",
    '  [[ -n "$_ENVPKT_INJECTED" ]] || return',
    "  local k had prev",
    "  for k in ${(s: :)_ENVPKT_INJECTED}; do",
    '    had="_ENVPKT_HAD_$k"',
    '    prev="_ENVPKT_PREV_$k"',
    '    if [[ -n "${(P)had}" ]]; then',
    '      export "$k=${(P)prev}"',
    "    else",
    '      unset "$k"',
    "    fi",
    '    unset "$had" "$prev"',
    "  done",
    "  unset _ENVPKT_INJECTED",
    "}",
    "",
    "_envpkt_chpwd() {",
    "  local cfg",
    '  cfg="$(envpkt config-path 2>/dev/null)"',
    '  [[ "$cfg" == "$_ENVPKT_DIR" ]] && return',
    "  _envpkt_restore",
    '  _ENVPKT_DIR="$cfg"',
    '  [[ -z "$cfg" ]] && return',
    '  eval "$(envpkt env export --track)"',
    ...(audit ? ["  envpkt audit --format minimal 2>/dev/null"] : []),
    "}",
    "",
    "autoload -Uz add-zsh-hook",
    "add-zsh-hook chpwd _envpkt_chpwd",
    "_envpkt_chpwd",
    "",
  ].join("\n")

const bashHook = (audit: boolean): string =>
  [
    '# envpkt shell hook — add to ~/.bashrc:  eval "$(envpkt shell-hook bash)"',
    "# Loads the current directory package on cd, restores the prior env on leave, warns on health.",
    "_envpkt_restore() {",
    '  [ -n "$_ENVPKT_INJECTED" ] || return',
    "  local k had prev",
    "  for k in $_ENVPKT_INJECTED; do",
    '    had="_ENVPKT_HAD_$k"',
    '    prev="_ENVPKT_PREV_$k"',
    '    if [ -n "${!had}" ]; then',
    '      export "$k=${!prev}"',
    "    else",
    '      unset "$k"',
    "    fi",
    '    unset "$had" "$prev"',
    "  done",
    "  unset _ENVPKT_INJECTED",
    "}",
    "",
    "_envpkt_prompt() {",
    '  [ "$PWD" = "$_ENVPKT_PWD" ] && return',
    '  _ENVPKT_PWD="$PWD"',
    "  local cfg",
    '  cfg="$(envpkt config-path 2>/dev/null)"',
    '  [ "$cfg" = "$_ENVPKT_DIR" ] && return',
    "  _envpkt_restore",
    '  _ENVPKT_DIR="$cfg"',
    '  [ -z "$cfg" ] && return',
    '  eval "$(envpkt env export --track)"',
    ...(audit ? ["  envpkt audit --format minimal 2>/dev/null"] : []),
    "}",
    "",
    "# Register on PROMPT_COMMAND, handling both the string and (bash 5.1+) array forms.",
    'if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then',
    '  case " ${PROMPT_COMMAND[*]} " in',
    '    *" _envpkt_prompt "*) ;;',
    "    *) PROMPT_COMMAND+=(_envpkt_prompt) ;;",
    "  esac",
    "else",
    '  case "$PROMPT_COMMAND" in',
    "    *_envpkt_prompt*) ;;",
    '    *) PROMPT_COMMAND="_envpkt_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;',
    "  esac",
    "fi",
    "_envpkt_prompt",
    "",
  ].join("\n")

export const runShellHook = (shell: string, options?: ShellHookOptions): void => {
  const audit = options?.audit !== false
  switch (shell) {
    case "zsh":
      console.log(zshHook(audit))
      break
    case "bash":
      console.log(bashHook(audit))
      break
    default:
      console.error(`${RED}Error:${RESET} Unsupported shell: ${shell}. Use "zsh" or "bash".`)
      process.exit(1)
  }
}
