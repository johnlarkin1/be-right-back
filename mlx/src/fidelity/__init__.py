"""Persona fidelity eval.

Measures whether a trained adapter fits the real person better than the base model.
Every metric compares two conditions on the same held-out examples:
the base model alone, and the base model plus the persona's LoRA adapter.
"""
