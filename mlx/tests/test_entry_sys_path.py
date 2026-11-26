"""Tests that every entry script can import its siblings without being installed.

Entry scripts are launched by the Rust subprocess runner as absolute paths --
never `python -m`, never with a `cwd` inside the project, and never with
PYTHONPATH set. So `sys.path[0]` is `mlx/src/entry/`, not `mlx/src/`, and an
import like `from config.embedding import ...` only resolves if the script puts
`mlx/src` on `sys.path` itself.

Nothing else supplies that path. `pyproject.toml` declares no `[build-system]`,
which makes this a *virtual* project (`uv.lock`: `source = { virtual = "." }`),
and `uv sync` installs a virtual project's dependencies but not the project.
The old `uv pip install -e` did install it, leaving an `__editable__` .pth that
added `mlx/src` to every interpreter in the venv -- which is why the four
scripts missing the bootstrap worked anyway, and why the switch to
`uv sync --frozen` broke them on fresh installs only.

A static check is deliberate: importing all seven scripts for real costs
minutes of model and torch loading, and the invariant worth defending is
structural -- a new entry script must not forget the bootstrap.
"""

import ast
from pathlib import Path

import pytest

ENTRY_DIR = Path(__file__).resolve().parent.parent / "src" / "entry"

# Top-level packages under mlx/src/. An entry script importing any of these is
# relying on mlx/src being on sys.path.
FIRST_PARTY = {
    "config",
    "constants",
    "core",
    "data",
    "entry",
    "ml",
    "pipelines",
    "progress",
    "utils",
}


def entry_scripts() -> list[Path]:
    return sorted(p for p in ENTRY_DIR.glob("*.py") if p.name != "__init__.py")


def test_entry_scripts_are_discovered():
    """Guard against the glob silently matching nothing and vacuously passing."""
    assert entry_scripts(), f"no entry scripts found under {ENTRY_DIR}"


def _bootstrap_line(tree: ast.Module) -> int | None:
    """Line number of the `sys.path.insert(...)` bootstrap, if present."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr not in {"insert", "append"}:
            continue
        target = node.func.value
        if (
            isinstance(target, ast.Attribute)
            and target.attr == "path"
            and isinstance(target.value, ast.Name)
            and target.value.id == "sys"
        ):
            return node.lineno
    return None


def _first_party_imports(tree: ast.Module) -> list[tuple[int, str]]:
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if node.level == 0 and root in FIRST_PARTY:
                found.append((node.lineno, node.module or ""))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in FIRST_PARTY:
                    found.append((node.lineno, alias.name))
    return sorted(found)


@pytest.mark.parametrize("script", entry_scripts(), ids=lambda p: p.name)
def test_first_party_imports_follow_sys_path_bootstrap(script: Path):
    """Any first-party import must come after the script puts mlx/src on sys.path.

    Without this, a fresh `uv sync --frozen` venv fails at first use with
    `ModuleNotFoundError: No module named 'config'` -- and setup still reports
    success, because verification never imports first-party code.
    """
    tree = ast.parse(script.read_text(), filename=str(script))
    imports = _first_party_imports(tree)
    if not imports:
        pytest.skip(f"{script.name} imports no first-party packages")

    bootstrap = _bootstrap_line(tree)
    assert bootstrap is not None, (
        f"{script.name} imports first-party packages "
        f"({', '.join(name for _, name in imports)}) but never adds mlx/src to sys.path. "
        f"Copy the bootstrap block from entry/rerank.py."
    )

    first_line, first_name = imports[0]
    assert bootstrap < first_line, (
        f"{script.name} imports '{first_name}' on line {first_line}, "
        f"before the sys.path bootstrap on line {bootstrap}."
    )
