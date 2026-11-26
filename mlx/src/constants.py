import re

# apple's core data epoch: 2001-01-01 00:00:00 UTC
# iMessage timestamps are in nanoseconds since this epoch
APPLE_EPOCH_OFFSET = 978307200

# Default models (highest tier - overridden by Rust based on VRAM)
HF_DEFAULT_BASE_MODEL = "mlx-community/Qwen3.5-9B-4bit"
HF_DEFAULT_AGENT_MODEL = "mlx-community/Qwen3.5-9B-4bit"

GPU_STR = "gpu"

# object replacement char (U+FFFC) - placeholder for images/attachments
OBJECT_REPLACEMENT_CHAR = "\ufffc"

# min chars for a message to be considered valid
MIN_MESSAGE_CHARS = 2

EOS_TOKENS = ["<|endoftext|>", "</s>", "<|im_end|>"]

CLUSTER_COLORS = [
    "#00ff41",  # green
    "#00d4ff",  # cyan
    "#ff6b9d",  # pink
    "#ffb000",  # amber
    "#a855f7",  # purple
    "#06b6d4",  # teal
    "#f43f5e",  # rose
    "#84cc16",  # lime
]
NOISE_COLOR = "#4a4a4a"

# fmt: off
GENERIC_LABEL_TERMS = {
    "discussion", "chat", "conversation", "plans", "talk", "updates", "coordination", "arrangements", "scheduling", "logistics", "general", "various",
    "miscellaneous", "mixed", "other", "stuff", "things", "topics", "messages", "texting",
    "doing", "going", "getting", "making", "having",
}
# fmt: on

# fmt: off
FILLER_WORDS = {"and", "the", "a", "an", "of", "in", "on", "with", "about", "for"}
# fmt: on

# fmt: off
STOP_WORDS = {
    # Articles / verbs / modals
    "the","a","an","is","are","was","were","be","been","being","have","has","had",
    "do","does","did","will","would","could","should","may","might","must","shall","can",

    # Prepositions / conjunctions
    "to","of","in","for","on","with","at","by","from","as","into","through","during",
    "before","after","above","below","between","under","and","but","if","or","because","until","while",

    # Adverbs / determiners
    "again","further","then","once","here","there","when","where","why","how",
    "all","each","few","more","most","other","some","such","no","nor","not","only",
    "own","same","so","than","too","very","just",

    # Demonstratives / relatives
    "this","that","these","those","what","which","who","whom","whose",

    # Pronouns
    "i","me","my","myself","we","our","ours","ourselves","you","your","yours","yourself","yourselves",
    "he","him","his","himself","she","her","hers","herself","it","its","itself",
    "they","them","their","theirs","themselves",

    # Contractions / texting
    "im","ive","youre","dont","didnt","wont","cant","isnt","arent","wasnt","werent",
    "hasnt","havent","hadnt","doesnt","wouldnt","couldnt","shouldnt",

    # Common fillers / slang
    "yeah","yea","yes","ok","okay","like","get","got","going","go","know","think",
    "want","see","come","make","take","good","well","back","now","way","even","new",
    "use","also","right","lol","haha","hahaha","lmao","omg","gonna","wanna","gotta",

    # Chat filler that says nothing about the topic
    "about","any","both","down","off","out","over","up","am","its","thats","theres","whats",
    "hes","shes","were","theyre","ill","youll","well","weve","youve","theyve","id","youd",
    "hey","hi","hello","thanks","thank","thx","sure","sounds","sound","really","much","still",
    "one","two","thing","things","stuff","something","anything","everything","nothing",
    "someone","anyone","everyone","said","say","says","tell","told","let","lets","need",
    "little","lot","lots","pretty","actually","maybe","probably","literally","definitely",
    "totally","kinda","sorta","though","tho","yet","ever","never","always","already","soon",
    "today","tomorrow","tonight","yesterday","time","day","days","week","night","morning",
    "later","last","next","first","many","every","another","around","since","yall",
    "dude","bro","man","guys","guy","girl","love","miss","feel","feeling","mean","look",
    "looks","looking","put","give","keep","try","wait","sorry","please","pls","plz","cool",
    "nice","great","awesome","fun","glad","hope","wow","yay","yup","yep","nope","nah","gotcha",
    "idk","tbh","imo","btw","rn","ngl","fr","smh","ttyl","bc","cuz","cause","because","prob",
    "via","www","http","https","com","image","attachment","sent","send","text","call","talk",
    "doing","done","did","went","came","made","took","getting","having","find",
    "lemme","aight","alright","yah","til","tmr","tmrw","whttpurl",

    # Profanity is tone, not topic
    "fuck","fucking","fucked","fuckin","shit","shitty","damn","hell","ass","bitch","crap",
}
# fmt: on


def get_cluster_color(cluster_id: int) -> str:
    if cluster_id < 0:
        return NOISE_COLOR
    return CLUSTER_COLORS[cluster_id % len(CLUSTER_COLORS)]


def is_label_specific(label: str) -> bool:
    """True when at least one word names something: "Dinner Plans" yes, "General Chat" no."""
    words = set(re.findall(r"[a-z0-9]+", label.lower()))
    return bool(words - GENERIC_LABEL_TERMS)
