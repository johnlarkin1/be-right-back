"""A tiny random language model and char-level ChatML tokenizer for MLX tests.

Lets the fidelity eval run end to end on CPU (including Linux with `mlx[cpu]`)
without downloading a model.
"""

from typing import Any

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
from mlx_lm.models import llama
from mlx_lm.tokenizer_utils import TokenizerWrapper
from mlx_lm.tuner.trainer import default_loss
from mlx_lm.tuner.utils import linear_to_lora_layers
from tokenizers import Regex, Tokenizer, decoders, models, pre_tokenizers
from transformers import PreTrainedTokenizerFast

CHATML = (
    "{% for m in messages %}<|im_start|>{{ m['role'] }}\n{{ m['content'] }}<|im_end|>\n"
    "{% endfor %}{% if add_generation_prompt %}<|im_start|>assistant\n{% endif %}"
)
SPECIALS = ["<unk>", "<|im_start|>", "<|im_end|>", "<|endoftext|>"]


def make_tokenizer() -> PreTrainedTokenizerFast:
    chars = [chr(c) for c in range(32, 127)] + ["\n"]
    vocab = {tok: i for i, tok in enumerate(SPECIALS + chars)}
    tok = Tokenizer(models.WordLevel(vocab=vocab, unk_token="<unk>"))
    tok.pre_tokenizer = pre_tokenizers.Split(Regex(r"[\s\S]"), behavior="isolated")
    tok.decoder = decoders.Fuse()
    hf = PreTrainedTokenizerFast(
        tokenizer_object=tok,
        unk_token="<unk>",
        eos_token="<|im_end|>",
        additional_special_tokens=SPECIALS[1:],
    )
    hf.chat_template = CHATML
    return hf


def make_model(vocab_size: int, seed: int = 0) -> nn.Module:
    mx.random.seed(seed)
    args = llama.ModelArgs(
        model_type="llama",
        hidden_size=32,
        num_hidden_layers=2,
        intermediate_size=64,
        num_attention_heads=4,
        num_key_value_heads=4,
        rms_norm_eps=1e-5,
        vocab_size=vocab_size,
        tie_word_embeddings=True,
    )
    model = llama.Model(args)
    model.freeze()
    linear_to_lora_layers(
        model,
        2,
        {
            "rank": 4,
            "scale": 10.0,
            "dropout": 0.0,
            "keys": ["self_attn.q_proj", "self_attn.v_proj", "mlp.down_proj"],
        },
    )
    mx.eval(model.parameters())
    return model


def make_model_and_tokenizer(seed: int = 0) -> tuple[nn.Module, TokenizerWrapper]:
    hf = make_tokenizer()
    # Spare rows so an added special token (like <MSG_BREAK>) still has an embedding,
    # the way Qwen's padded vocabulary does.
    model = make_model(len(hf) + 8, seed)
    return model, TokenizerWrapper(hf)


def train_lora(model: nn.Module, tokenizer: Any, examples: list[dict], steps: int = 40) -> None:
    """Fit the LoRA weights to the final assistant turn of `examples`."""
    from mlx_lm.tuner.datasets import ChatDataset

    ds = ChatDataset(examples, tokenizer, chat_key="messages", mask_prompt=True)
    batches = []
    for i in range(len(ds)):
        tokens, offset = ds.process(ds[i])
        batches.append((mx.array(tokens)[None], mx.array([[offset, len(tokens)]])))

    opt = optim.Adam(learning_rate=1e-2)
    loss_and_grad = nn.value_and_grad(model, lambda m, b, lens: default_loss(m, b, lens)[0])
    model.train()
    for step in range(steps):
        batch, lengths = batches[step % len(batches)]
        _, grads = loss_and_grad(model, batch, lengths)
        opt.update(model, grads)
        mx.eval(model.parameters(), opt.state)
    model.eval()
