"""Synthetic iMessage corpus generation for Be Right Back.

Builds a schema-accurate ``chat.db`` and AddressBook from an authored world
manifest, so the whole pipeline -- ingest, embed, hybrid search, Casper, insights,
persona training -- can be demoed and evaluated without touching real messages.
"""

from brb_synthetic.build import BuildReport, build_corpus, write_sidecars
from brb_synthetic.install import install, uninstall
from brb_synthetic.models import World
from brb_synthetic.verify import verify
from brb_synthetic.world import load_world

__all__ = [
    "BuildReport",
    "World",
    "build_corpus",
    "install",
    "load_world",
    "uninstall",
    "verify",
    "write_sidecars",
]
