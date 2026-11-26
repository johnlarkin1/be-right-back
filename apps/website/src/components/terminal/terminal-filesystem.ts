import { ARTICLES } from "@/lib/articles";

export interface FSNode {
  name: string;
  type: "file" | "directory";
  route?: string;
  description?: string;
  children?: FSNode[];
}

function buildHowItsBuiltChildren(): FSNode[] {
  return [
    {
      name: "index.md",
      type: "file",
      route: "/how-its-built",
      description:
        "A deep dive into how Be Right Back is built — from iMessage parsing to local LLM training.",
    },
    ...ARTICLES.map((a) => ({
      name: `${a.slug}.md`,
      type: "file" as const,
      route: `/how-its-built/${a.slug}`,
      description: a.description,
    })),
  ];
}

export const FILE_SYSTEM: FSNode = {
  name: "/",
  type: "directory",
  route: "/",
  children: [
    {
      name: "README.md",
      type: "file",
      route: "/",
      description:
        "Be Right Back — a local-first macOS app that creates AI personas from your iMessage history. All processing on-device with Apple Silicon.",
    },
    {
      name: "about",
      type: "directory",
      route: "/how-its-built/preface",
      children: [
        {
          name: "index.md",
          type: "file",
          route: "/how-its-built/preface",
          description:
            "The story behind Be Right Back — why it exists, what it does, and the ethics of building with personal data.",
        },
      ],
    },
    {
      name: "download",
      type: "directory",
      route: "/download",
      children: [
        {
          name: "index.md",
          type: "file",
          route: "/download",
          description:
            "Download Be Right Back for macOS. Requires Apple Silicon (M1/M2/M3/M4) and macOS 14.0+.",
        },
      ],
    },
    {
      name: "playground",
      type: "directory",
      route: "/playground",
      children: [
        {
          name: "index.md",
          type: "file",
          route: "/playground",
          description:
            "Interactive, hands-on explainers for the tech behind Be Right Back — chunking, BM25 scoring, attributedBody decoding, and more.",
        },
      ],
    },
    {
      name: "how-its-built",
      type: "directory",
      route: "/how-its-built",
      children: buildHowItsBuiltChildren(),
    },
  ],
};

/**
 * Resolve a path string to an absolute path given a current working directory.
 * Supports: absolute paths (/about), relative (about), .. , . , ~ (root)
 */
export function resolvePath(cwd: string, target: string): string {
  if (target === "~" || target === "/") return "/";

  let parts: string[];
  if (target.startsWith("/")) {
    parts = target.split("/").filter(Boolean);
  } else if (target.startsWith("~")) {
    parts = target.slice(2).split("/").filter(Boolean);
  } else {
    const cwdParts = cwd.split("/").filter(Boolean);
    parts = [...cwdParts, ...target.split("/").filter(Boolean)];
  }

  const resolved: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return "/" + resolved.join("/");
}

/**
 * Get a filesystem node at a given absolute path.
 * Returns null if not found.
 */
export function getNode(path: string): FSNode | null {
  if (path === "/") return FILE_SYSTEM;

  const parts = path.split("/").filter(Boolean);
  let current: FSNode = FILE_SYSTEM;

  for (const part of parts) {
    if (!current.children) return null;
    const child = current.children.find((c) => c.name === part || c.name === `${part}.md`);
    if (!child) return null;
    current = child;
  }
  return current;
}

/**
 * Map a Next.js pathname to a virtual filesystem path.
 */
export function pathnameToFSPath(pathname: string): string {
  if (pathname === "/") return "/";
  // Strip trailing slash
  const clean = pathname.replace(/\/$/, "");
  // Check if it's a direct directory match
  const node = getNode(clean);
  if (node && node.type === "directory") return clean;
  // Otherwise return the path as-is (it maps to a directory)
  return clean || "/";
}

/**
 * Generate a tree representation of the filesystem.
 */
export function generateTree(node: FSNode = FILE_SYSTEM, prefix: string = "", isRoot: boolean = true): string[] {
  const lines: string[] = [];

  if (isRoot) {
    lines.push("/");
  }

  if (node.children) {
    node.children.forEach((child, i) => {
      const isLast = i === node.children!.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const name = child.type === "directory" ? `${child.name}/` : child.name;
      lines.push(prefix + connector + name);

      if (child.children) {
        const childPrefix = prefix + (isLast ? "    " : "│   ");
        lines.push(...generateTree(child, childPrefix, false));
      }
    });
  }

  return lines;
}
