#!/bin/bash
# Download pre-quantized ACE-Step GGUF models from HuggingFace
# No Python required — uses curl (or wget as fallback)
#
# Usage: ./models.sh [options]
#   default:    Q8_0 turbo essentials (VAE + text-encoder + LM-4B + DiT-turbo)
#   --all:      all models, all quants
#   --quant X:  use quant X (Q4_K_M, Q5_K_M, Q6_K, Q8_0, BF16)
#   --lm SIZE:  LM size (0.6B, 1.7B, 4B — default: 4B)
#   --sft:      include SFT DiT variant
#   --base:     include base DiT variant
#   --shifts:   include shift1/shift3/continuous DiT variants
#   --dir DIR:  download directory (default: ./models)
#   --hf-token TOKEN: HuggingFace token for private/gated repos

set -eu

REPO="Serveurperso/ACE-Step-1.5-GGUF"
DIR="${MODELS_DIR:-models}"
QUANT="Q8_0"
LM_SIZE="4B"
ALL=0
SFT=0
BASE=0
SHIFTS=0
HF_TOKEN="${HF_TOKEN:-}"

while [ $# -gt 0 ]; do
    case "$1" in
        --all)      ALL=1 ;;
        --quant)    QUANT="$2"; shift ;;
        --lm)       LM_SIZE="$2"; shift ;;
        --sft)      SFT=1 ;;
        --base)     BASE=1 ;;
        --shifts)   SHIFTS=1 ;;
        --dir)      DIR="$2"; shift ;;
        --hf-token) HF_TOKEN="$2"; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
    shift
done

mkdir -p "$DIR"

# Resolve download tool
if command -v curl &>/dev/null; then
    DL_TOOL="curl"
elif command -v wget &>/dev/null; then
    DL_TOOL="wget"
else
    echo "Error: curl or wget is required to download models." >&2
    echo "Install with: sudo apt install curl   OR   brew install curl" >&2
    exit 1
fi

HF_BASE="https://huggingface.co/$REPO/resolve/main"

dl() {
    local file="$1"
    local dest="$DIR/$file"

    if [ -f "$dest" ]; then
        local size
        size=$(wc -c < "$dest" 2>/dev/null || echo 0)
        if [ "$size" -gt 1048576 ]; then   # > 1 MB → assume complete
            echo "[OK]       $file"
            return
        fi
    fi

    echo "[Download] $file"
    local url="$HF_BASE/$file"
    local tmp="${dest}.part"

    if [ "$DL_TOOL" = "curl" ]; then
        if [ -n "$HF_TOKEN" ]; then
            curl -fL --progress-bar --retry 3 --retry-delay 5 \
                -H "Authorization: Bearer $HF_TOKEN" \
                -o "$tmp" "$url"
        else
            curl -fL --progress-bar --retry 3 --retry-delay 5 \
                -o "$tmp" "$url"
        fi
    else
        if [ -n "$HF_TOKEN" ]; then
            wget -q --show-progress --tries=3 --waitretry=5 \
                --header="Authorization: Bearer $HF_TOKEN" \
                -O "$tmp" "$url"
        else
            wget -q --show-progress --tries=3 --waitretry=5 \
                -O "$tmp" "$url"
        fi
    fi

    mv "$tmp" "$dest"
    echo "[Saved]    $dest"
}

# Resolve quant to best available for each model type.
# Matches quantize.sh matrix exactly:
#   Embedding / LM-small: BF16, Q8_0 only
#   LM-4B:                BF16, Q5_K_M, Q6_K, Q8_0 (Q4_K_M breaks audio codes)
#   DiT:                  BF16, Q4_K_M, Q5_K_M, Q6_K, Q8_0
resolve_quant() {
    local requested="$1" model_type="$2"
    case "$model_type" in
        emb|lm_small)
            case "$requested" in
                BF16) echo "BF16" ;;
                *)    echo "Q8_0" ;;
            esac ;;
        lm_4B)
            case "$requested" in
                BF16)           echo "BF16"   ;;
                Q8_0)           echo "Q8_0"   ;;
                Q6_K)           echo "Q6_K"   ;;
                Q5_K_M|Q4_K_M) echo "Q5_K_M" ;;
                *)              echo "Q8_0"   ;;
            esac ;;
        dit)
            echo "$requested" ;;
    esac
}

# ── Default essential set ────────────────────────────────────────────────────

# VAE — always BF16 (small, quality-critical)
dl "vae-BF16.gguf"

# Text encoder
dl "Qwen3-Embedding-0.6B-$(resolve_quant "$QUANT" emb).gguf"

# LM
if [ "$LM_SIZE" = "4B" ]; then
    dl "acestep-5Hz-lm-4B-$(resolve_quant "$QUANT" lm_4B).gguf"
else
    dl "acestep-5Hz-lm-${LM_SIZE}-$(resolve_quant "$QUANT" lm_small).gguf"
fi

# DiT turbo (always included)
dl "acestep-v15-turbo-${QUANT}.gguf"

# ── Optional DiT variants ────────────────────────────────────────────────────

if [ "$SFT" = 1 ] || [ "$ALL" = 1 ]; then
    dl "acestep-v15-sft-${QUANT}.gguf"
fi
if [ "$BASE" = 1 ] || [ "$ALL" = 1 ]; then
    dl "acestep-v15-base-${QUANT}.gguf"
fi
if [ "$SHIFTS" = 1 ] || [ "$ALL" = 1 ]; then
    dl "acestep-v15-turbo-shift1-${QUANT}.gguf"
    dl "acestep-v15-turbo-shift3-${QUANT}.gguf"
    dl "acestep-v15-turbo-continuous-${QUANT}.gguf"
fi

# ── --all: every model × every valid quant ───────────────────────────────────

if [ "$ALL" = 1 ]; then
    # Embedding: BF16 + Q8_0 only
    dl "Qwen3-Embedding-0.6B-BF16.gguf"

    # Small/medium LM: BF16 + Q8_0 only
    for lm in 0.6B 1.7B; do
        dl "acestep-5Hz-lm-${lm}-BF16.gguf"
        dl "acestep-5Hz-lm-${lm}-Q8_0.gguf"
    done

    # Large LM: BF16 + Q5_K_M / Q6_K / Q8_0 (Q4_K_M breaks audio codes)
    for q in BF16 Q5_K_M Q6_K Q8_0; do
        dl "acestep-5Hz-lm-4B-${q}.gguf"
    done

    # DiT variants: all quants
    for dit in turbo sft base turbo-shift1 turbo-shift3 turbo-continuous; do
        for q in BF16 Q4_K_M Q5_K_M Q6_K Q8_0; do
            dl "acestep-v15-${dit}-${q}.gguf"
        done
    done
fi

echo ""
echo "[Done] Models ready in $DIR/"
echo ""
echo "Set ACESTEP_MODEL to your primary DiT model, e.g.:"
echo "  export ACESTEP_MODEL=\"$(cd "$DIR" && pwd)/acestep-v15-turbo-${QUANT}.gguf\""
