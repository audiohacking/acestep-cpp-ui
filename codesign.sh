#!/bin/bash
# Code signing script for AceForge macOS application
# This script signs the .app bundle to avoid security warnings during development
# Adapted from: https://github.com/dylanwh/lilguy/blob/main/macos/build.sh

set -euo pipefail

# Configuration
APP_PATH="${1:-dist/AceForge.app}"
SIGNING_IDENTITY="${MACOS_SIGNING_IDENTITY:--}"  # Default to ad-hoc signing with "-"
ENTITLEMENTS_PATH="build/macos/entitlements.plist"

echo "=================================================="
echo "AceForge macOS Code Signing"
echo "=================================================="
echo "App path: $APP_PATH"
echo "Signing identity: $SIGNING_IDENTITY"
echo "Entitlements: $ENTITLEMENTS_PATH"
echo ""

# Check if the app bundle exists
if [ ! -d "$APP_PATH" ]; then
    echo "Error: App bundle not found at $APP_PATH"
    exit 1
fi

# Check if entitlements file exists
if [ ! -f "$ENTITLEMENTS_PATH" ]; then
    echo "Error: Entitlements file not found at $ENTITLEMENTS_PATH"
    exit 1
fi

# Function to sign a binary or framework
sign_binary() {
    local target="$1"
    echo "Signing: $target"
    
    # Build codesign command
    local cmd=(
        xcrun codesign
        --sign "$SIGNING_IDENTITY"
        --force
        --options runtime
        --entitlements "$ENTITLEMENTS_PATH"
        --deep
        --timestamp
        "$target"
    )
    
    # For ad-hoc signing, we don't use timestamp
    if [ "$SIGNING_IDENTITY" = "-" ]; then
        cmd=(
            xcrun codesign
            --sign "$SIGNING_IDENTITY"
            --force
            --options runtime
            --entitlements "$ENTITLEMENTS_PATH"
            --deep
            "$target"
        )
    fi
    
    # Execute signing
    if "${cmd[@]}"; then
        echo "✓ Successfully signed: $target"
        return 0
    else
        echo "✗ Failed to sign: $target"
        return 1
    fi
}

# Sign all executables and frameworks in the app bundle
echo "Step 1: Signing frameworks and libraries..."
find "$APP_PATH/Contents" -type f \( -name "*.dylib" -o -name "*.so" \) -print0 | while IFS= read -r -d '' lib; do
    sign_binary "$lib" || true  # Continue even if individual libs fail
done

# Sign all Python framework binaries if they exist
if [ -d "$APP_PATH/Contents/Frameworks" ]; then
    find "$APP_PATH/Contents/Frameworks" -type f -perm -111 -print0 | while IFS= read -r -d '' binary; do
        sign_binary "$binary" || true
    done
fi

echo ""
echo "Step 2: Signing main executables..."
# Sign the main executables
for exe in "$APP_PATH/Contents/MacOS"/*; do
    if [ -f "$exe" ] && [ -x "$exe" ]; then
        sign_binary "$exe"
    fi
done

echo ""
echo "Step 3: Signing the app bundle..."
# Finally, sign the entire app bundle
if sign_binary "$APP_PATH"; then
    echo ""
    echo "=================================================="
    echo "✓ Code signing completed successfully!"
    echo "=================================================="
    echo ""
    echo "Verification:"
    xcrun codesign --verify --deep --strict --verbose=2 "$APP_PATH" 2>&1 || true
    echo ""
    echo "Signature info:"
    xcrun codesign -dv --verbose=4 "$APP_PATH" 2>&1 || true
    exit 0
else
    echo ""
    echo "=================================================="
    echo "✗ Code signing failed!"
    echo "=================================================="
    exit 1
fi
