import { RED, RESET } from "../output.js"

const ZSH_HOOK = `# envpkt shell hook — add to your .zshrc
_envpkt_chpwd() {
  if [[ -f envpkt.toml ]]; then
    envpkt audit --format minimal 2>/dev/null
  fi
}

if (( $+functions[add-zsh-hook] )); then
  autoload -Uz add-zsh-hook
  add-zsh-hook chpwd _envpkt_chpwd
else
  autoload -Uz add-zsh-hook
  add-zsh-hook chpwd _envpkt_chpwd
fi
`

const BASH_HOOK = `# envpkt shell hook — add to your .bashrc
_envpkt_prompt() {
  if [[ -f envpkt.toml ]]; then
    envpkt audit --format minimal 2>/dev/null
  fi
}

if [[ ! "$PROMPT_COMMAND" == *"_envpkt_prompt"* ]]; then
  PROMPT_COMMAND="_envpkt_prompt;$PROMPT_COMMAND"
fi
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
