import {
  FILE_SYSTEM,
  resolvePath,
  getNode,
  generateTree,
} from "./terminal-filesystem";

export interface OutputLine {
  text: string;
  className?: string;
}

export interface CommandContext {
  currentPath: string;
  setCurrentPath: (path: string) => void;
  navigate: (route: string) => void;
  clearHistory: () => void;
  closeTerminal: () => void;
  commandHistory: string[];
}

type CommandHandler = (
  args: string[],
  ctx: CommandContext
) => OutputLine[] | "clear";

const COMMANDS: Record<string, CommandHandler> = {
  help: () => {
    return [
      { text: "Available commands:", className: "text-crt-accent font-bold" },
      { text: "" },
      { text: "  ls [path]          List directory contents" },
      { text: "  cd <path>          Change directory (navigates the site)" },
      { text: "  pwd                Print current directory" },
      { text: "  cat <file>         Show page description" },
      { text: "  tree               Show full site structure" },
      { text: "" },
      { text: "  help               Show this help message" },
      { text: "  man <cmd>          Detailed help for a command" },
      { text: "  whoami             Who are you?" },
      { text: "  uname -a           System information" },
      { text: "  echo <text>        Echo text" },
      { text: "  date               Current date and time" },
      { text: "  history            Show command history" },
      { text: "  clear              Clear terminal" },
      { text: "  exit               Close terminal" },
      { text: "" },
      { text: "  neofetch           System info with ASCII art" },
      { text: "  cowsay <msg>       Ghost says something" },
      { text: "  ping casper        Ping the ghost" },
      { text: "" },
      {
        text: "Tab to autocomplete. Up/Down for history.",
        className: "text-crt-body-muted",
      },
    ];
  },

  ls: (args, ctx) => {
    const targetPath = args[0] ? resolvePath(ctx.currentPath, args[0]) : ctx.currentPath;
    const node = getNode(targetPath);

    if (!node) {
      return [{ text: `ls: cannot access '${args[0]}': No such file or directory`, className: "text-red-400" }];
    }

    if (node.type === "file") {
      return [{ text: node.name, className: "text-crt-text" }];
    }

    if (!node.children || node.children.length === 0) {
      return [];
    }

    return node.children.map((child) => ({
      text: child.type === "directory" ? `${child.name}/` : child.name,
      className: child.type === "directory" ? "text-crt-accent font-bold" : "text-crt-text",
    }));
  },

  cd: (args, ctx) => {
    if (args.length === 0) {
      ctx.setCurrentPath("/");
      ctx.navigate("/");
      return [];
    }

    const target = args[0];
    const resolved = resolvePath(ctx.currentPath, target);
    const node = getNode(resolved);

    if (!node) {
      return [{ text: `cd: no such directory: ${target}`, className: "text-red-400" }];
    }

    if (node.type === "file") {
      // If it's a .md file, cd to parent dir but hint to use cat
      return [{ text: `cd: not a directory: ${target} (try: cat ${target})`, className: "text-red-400" }];
    }

    ctx.setCurrentPath(resolved);
    if (node.route) {
      ctx.navigate(node.route);
    }
    return [];
  },

  pwd: (_args, ctx) => {
    return [{ text: ctx.currentPath }];
  },

  cat: (args, ctx) => {
    if (args.length === 0) {
      return [{ text: "cat: missing operand", className: "text-red-400" }];
    }

    const target = args[0];
    const resolved = resolvePath(ctx.currentPath, target);
    const node = getNode(resolved);

    if (!node) {
      return [{ text: `cat: ${target}: No such file or directory`, className: "text-red-400" }];
    }

    if (node.type === "directory") {
      return [{ text: `cat: ${target}: Is a directory`, className: "text-red-400" }];
    }

    if (!node.description) {
      return [{ text: "(empty file)" , className: "text-crt-body-muted" }];
    }

    return [
      { text: "" },
      { text: node.description },
      { text: "" },
      ...(node.route ? [{ text: `→ ${node.route}`, className: "text-crt-accent" }] : []),
    ];
  },

  tree: () => {
    const lines = generateTree(FILE_SYSTEM);
    return lines.map((line) => {
      const isDir = line === "/" || line.endsWith("/");
      return { text: line, className: isDir ? "text-crt-accent" : undefined };
    });
  },

  clear: () => "clear",

  echo: (args) => {
    return [{ text: args.join(" ") }];
  },

  whoami: () => {
    const isGhost = Math.random() < 0.15;
    return [{ text: isGhost ? "ghost" : "visitor", className: isGhost ? "text-crt-cyan" : undefined }];
  },

  "uname": (args) => {
    if (args.includes("-a")) {
      return [{ text: "BRB-OS 1.0.0 berightback.xyz ARM64 Apple-Silicon-Optimized" }];
    }
    return [{ text: "BRB-OS" }];
  },

  date: () => {
    return [{ text: new Date().toString() }];
  },

  history: (_args, ctx) => {
    return ctx.commandHistory.map((cmd, i) => ({
      text: `  ${String(i + 1).padStart(4)}  ${cmd}`,
    }));
  },

  exit: (_args, ctx) => {
    setTimeout(() => ctx.closeTerminal(), 300);
    return [
      { text: "logout", className: "text-crt-body-muted" },
      { text: "Connection to berightback.xyz closed.", className: "text-crt-body-muted" },
    ];
  },

  man: (args) => {
    if (args.length === 0) {
      return [{ text: "What manual page do you want?", className: "text-crt-body-muted" }];
    }

    const manPages: Record<string, OutputLine[]> = {
      ls: [
        { text: "LS(1)", className: "text-crt-accent font-bold" },
        { text: "" },
        { text: "NAME" },
        { text: "    ls - list directory contents" },
        { text: "" },
        { text: "SYNOPSIS" },
        { text: "    ls [path]" },
        { text: "" },
        { text: "DESCRIPTION" },
        { text: "    List the contents of the current directory, or the" },
        { text: "    specified path. Directories shown in amber, files in green." },
      ],
      cd: [
        { text: "CD(1)", className: "text-crt-accent font-bold" },
        { text: "" },
        { text: "NAME" },
        { text: "    cd - change directory (navigate the site)" },
        { text: "" },
        { text: "SYNOPSIS" },
        { text: "    cd <path>" },
        { text: "" },
        { text: "DESCRIPTION" },
        { text: "    Navigate to a different section of the site. Supports" },
        { text: "    absolute paths (/about), relative paths (about)," },
        { text: "    parent directory (..), and home (~)." },
        { text: "" },
        { text: "EXAMPLES" },
        { text: "    cd about              Navigate to /about" },
        { text: "    cd how-its-built      Navigate to the articles" },
        { text: "    cd ..                 Go up one level" },
        { text: "    cd ~                  Go home" },
      ],
      cat: [
        { text: "CAT(1)", className: "text-crt-accent font-bold" },
        { text: "" },
        { text: "NAME" },
        { text: "    cat - show page description" },
        { text: "" },
        { text: "SYNOPSIS" },
        { text: "    cat <file>" },
        { text: "" },
        { text: "DESCRIPTION" },
        { text: "    Display the description of a page. Use on .md files" },
        { text: "    to read a summary of the page's content." },
      ],
    };

    const page = manPages[args[0]];
    if (!page) {
      return [{ text: `No manual entry for ${args[0]}`, className: "text-red-400" }];
    }
    return page;
  },

  // Easter eggs
  neofetch: () => {
    return [
      { text: "     .-.", className: "text-crt-cyan" },
      { text: "    (o o)", className: "text-crt-cyan" },
      { text: "    | O |", className: "text-crt-cyan" },
      { text: "     ^^^", className: "text-crt-cyan" },
      { text: "" },
      { text: "  visitor@berightback.xyz", className: "text-crt-accent font-bold" },
      { text: "  ─────────────────────" },
      { text: `  OS:       BRB-OS 1.0 (Apple Silicon)` },
      { text: `  Shell:    brb-terminal 1.0` },
      { text: `  Stack:    Next.js 16 / React 19 / Tailwind 4` },
      { text: `  Backend:  Rust + Tauri v2` },
      { text: `  ML:       MLX (Apple Silicon)` },
      { text: `  Articles: 10` },
      { text: `  Theme:    CRT Green / Amber` },
      { text: `  Uptime:   since you arrived` },
    ];
  },

  cowsay: (args) => {
    const msg = args.length > 0 ? args.join(" ") : "moo?";
    const border = "─".repeat(msg.length + 2);
    return [
      { text: ` ┌${border}┐` },
      { text: ` │ ${msg} │` },
      { text: ` └${border}┘` },
      { text: "    \\", className: "text-crt-cyan" },
      { text: "     \\", className: "text-crt-cyan" },
      { text: "      .-.", className: "text-crt-cyan" },
      { text: "     (o o)", className: "text-crt-cyan" },
      { text: "     | O |", className: "text-crt-cyan" },
      { text: "      ^^^", className: "text-crt-cyan" },
    ];
  },

  ping: (args) => {
    if (args[0] === "casper") {
      return [
        { text: "PING casper (ghost://local) 56 data bytes" },
        { text: "64 bytes from casper: seq=0 ttl=64 time=0.42ms", className: "text-crt-text" },
        { text: "64 bytes from casper: seq=1 ttl=64 time=0.38ms", className: "text-crt-text" },
        { text: "64 bytes from casper: seq=2 ttl=64 time=0.41ms", className: "text-crt-text" },
        { text: "" },
        { text: "--- casper ping statistics ---" },
        { text: "3 packets transmitted, 3 packets received, 0% packet loss" },
      ];
    }
    return [{ text: `ping: unknown host: ${args[0] ?? "(none)"}`, className: "text-red-400" }];
  },

  sudo: (args) => {
    if (args.join(" ").includes("rm")) {
      return [
        { text: "nice try. the ghosts are watching.", className: "text-red-400" },
      ];
    }
    return [
      { text: "visitor is not in the sudoers file. This incident will be reported.", className: "text-red-400" },
    ];
  },

  "./brb": () => {
    return [
      { text: "Initializing Be Right Back...", className: "text-crt-accent" },
      { text: "Loading persona engine......... done" },
      { text: "Connecting to iMessage DB...... done" },
      { text: "Warming up MLX runtime......... done" },
      { text: "Spawning Casper agent.......... done" },
      { text: "" },
      { text: "Ready. Your digital persona is waiting.", className: "text-crt-text font-bold" },
      { text: "Visit /download to get started.", className: "text-crt-accent" },
    ];
  },
};

export function executeCommand(
  input: string,
  ctx: CommandContext
): OutputLine[] | "clear" {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // Handle ./brb as a special case
  if (trimmed === "./brb") {
    return COMMANDS["./brb"]([], ctx);
  }

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  // Handle sudo specially — pass everything after sudo
  if (cmd === "sudo") {
    return COMMANDS.sudo(args, ctx);
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    return [
      {
        text: `command not found: ${cmd}. Type 'help' for available commands.`,
        className: "text-red-400",
      },
    ];
  }

  return handler(args, ctx);
}

/**
 * Get tab completion candidates for partial input.
 */
export function getCompletions(
  partial: string,
  currentPath: string
): string[] {
  const parts = partial.split(/\s+/);

  // Complete command names
  if (parts.length <= 1) {
    const prefix = parts[0]?.toLowerCase() ?? "";
    const cmdNames = Object.keys(COMMANDS).filter((c) => c !== "./brb");
    return cmdNames
      .filter((c) => c.startsWith(prefix))
      .sort();
  }

  // Complete paths for cd, cat, ls
  const cmd = parts[0].toLowerCase();
  if (!["cd", "cat", "ls"].includes(cmd)) return [];

  const pathPart = parts[parts.length - 1] ?? "";
  const dirPath = pathPart.includes("/")
    ? resolvePath(currentPath, pathPart.substring(0, pathPart.lastIndexOf("/")) || "/")
    : currentPath;
  const prefix = pathPart.includes("/")
    ? pathPart.substring(pathPart.lastIndexOf("/") + 1)
    : pathPart;

  const dirNode = getNode(dirPath);
  if (!dirNode?.children) return [];

  return dirNode.children
    .filter((c) => c.name.startsWith(prefix))
    .map((c) => {
      const basePath = parts.slice(0, -1).join(" ");
      const pathPrefix = pathPart.includes("/")
        ? pathPart.substring(0, pathPart.lastIndexOf("/") + 1)
        : "";
      const name = c.type === "directory" ? `${c.name}/` : c.name;
      return `${basePath} ${pathPrefix}${name}`;
    })
    .sort();
}
