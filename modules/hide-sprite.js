import { extensionName } from "../constants.js";
import { getSpriteList } from "../utils.js";

// In-memory state (per-session only)
let hiddenSpriteIds = new Set();
let originalSrcMap = new Map();
let placeholderImages = [];
let spriteObservers = new Map(); // Track MutationObservers for hidden sprites

/**
 * Get the current placeholder path
 */
function getPlaceholderPath() {
    if (placeholderImages.length > 0) {
        return `/characters/Placeholder/${placeholderImages[0]}`;
    }
    return "";
}

/**
 * Apply placeholder to all visible img elements in a sprite container
 */
function applyPlaceholderToSprite(spriteId) {
    const sprite = $(`#${CSS.escape(spriteId)}`);
    if (!sprite.length) return;

    const placeholderPath = getPlaceholderPath();
    const imgs = sprite.find("img");

    imgs.each(function() {
        const currentSrc = $(this).attr("src");
        if (currentSrc && currentSrc !== placeholderPath) {
            // Store the latest original src
            originalSrcMap.set(spriteId, currentSrc);
            $(this).attr("src", placeholderPath);
        }
    });
}

/**
 * Start observing a sprite container for child/attribute changes
 */
function observeSpriteChanges(spriteId, sprite) {
    // Disconnect existing observer if any
    if (spriteObservers.has(spriteId)) {
        spriteObservers.get(spriteId).disconnect();
    }

    const container = sprite.get(0);
    if (!container) return;

    const observer = new MutationObserver((mutations) => {
        if (!hiddenSpriteIds.has(spriteId)) return;

        let needsReapply = false;

        for (const mutation of mutations) {
            // Check for new img elements added
            if (mutation.type === "childList") {
                for (const node of mutation.addedNodes) {
                    if (node.nodeName === "IMG") {
                        needsReapply = true;
                        break;
                    }
                }
            }
            // Check for src attribute changes on img elements
            if (mutation.type === "attributes" && mutation.attributeName === "src") {
                if (mutation.target.nodeName === "IMG") {
                    needsReapply = true;
                }
            }
        }

        if (needsReapply) {
            applyPlaceholderToSprite(spriteId);
            console.debug(`[${extensionName}] Re-applied placeholder for: ${spriteId}`);
        }
    });

    // Observe both child changes and attribute changes on descendants
    observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"]
    });
    spriteObservers.set(spriteId, observer);
}

/**
 * Stop observing a sprite container
 */
function stopObservingSprite(spriteId) {
    if (spriteObservers.has(spriteId)) {
        spriteObservers.get(spriteId).disconnect();
        spriteObservers.delete(spriteId);
    }
}

/**
 * Fetch placeholder images from characters/Placeholder folder
 */
async function fetchPlaceholderImages() {
    try {
        placeholderImages = await getSpriteList("Placeholder");
        console.debug(`[${extensionName}] Placeholder images loaded: ${placeholderImages.length}`);
    } catch (err) {
        console.error(`[${extensionName}] Failed to load placeholder images:`, err);
        placeholderImages = [];
    }
}

/**
 * Get the currently focused sprite element (or fallback to any visible sprite)
 * @returns {jQuery|null}
 */
function getFocusedSprite() {
    // Group chat sprites with focus
    const groupFocused = $("#visual-novel-wrapper .prome-sprite-focus");
    if (groupFocused.length) {
        return groupFocused.first();
    }

    // Solo chat sprite with focus
    const soloFocused = $("#expression-holder.prome-sprite-focus");
    if (soloFocused.length) {
        return soloFocused.first();
    }

    // User sprite with focus
    const userFocused = $("#expression-prome-user.prome-sprite-focus");
    if (userFocused.length) {
        return userFocused.first();
    }

    // Fallback: Solo chat sprite without focus class
    const soloSprite = $("#expression-holder");
    if (soloSprite.length && soloSprite.find("img").length) {
        return soloSprite.first();
    }

    // Fallback: Any group sprite without focus class
    const groupSprites = $("#visual-novel-wrapper > div").filter(function() {
        return $(this).find("img").length > 0;
    });
    if (groupSprites.length) {
        return groupSprites.first();
    }

    return null;
}

/**
 * Get the image element from a sprite container
 * @param {jQuery} sprite
 * @returns {jQuery|null}
 */
function getSpriteImage(sprite) {
    // Try direct img child first
    let img = sprite.find("img").first();
    if (img.length) return img;

    // For expression-holder, the container itself may have the image
    if (sprite.is("img")) return sprite;

    return null;
}

/**
 * Update button icon based on focused sprite state
 */
function updateButtonIcon() {
    const btn = $("#prome-hide-sprite-btn");
    if (!btn.length) return;

    const focusedSprite = getFocusedSprite();
    if (!focusedSprite) {
        btn.removeClass("fa-eye-slash").addClass("fa-eye");
        return;
    }

    const spriteId = focusedSprite.attr("id");
    const isHidden = hiddenSpriteIds.has(spriteId);

    if (isHidden) {
        btn.removeClass("fa-eye").addClass("fa-eye-slash");
    } else {
        btn.removeClass("fa-eye-slash").addClass("fa-eye");
    }
}

/**
 * Toggle visibility of the currently focused sprite
 */
export function toggleHideSprite() {
    const focusedSprite = getFocusedSprite();
    if (!focusedSprite) {
        toastr.warning("No focused sprite to hide.", extensionName);
        return;
    }

    const spriteId = focusedSprite.attr("id");
    const img = getSpriteImage(focusedSprite);

    if (!img) {
        console.error(`[${extensionName}] Could not find image in sprite`);
        return;
    }

    if (hiddenSpriteIds.has(spriteId)) {
        // Stop observing before restoring
        stopObservingSprite(spriteId);

        // Restore original
        const originalSrc = originalSrcMap.get(spriteId);
        if (originalSrc) {
            img.attr("src", originalSrc);
        }
        hiddenSpriteIds.delete(spriteId);
        originalSrcMap.delete(spriteId);
        console.debug(`[${extensionName}] Sprite restored: ${spriteId}`);
    } else {
        // Store original and apply placeholder
        originalSrcMap.set(spriteId, img.attr("src"));

        const placeholderPath = getPlaceholderPath();
        img.attr("src", placeholderPath);

        hiddenSpriteIds.add(spriteId);

        // Start observing the container for changes (ST replaces img elements)
        observeSpriteChanges(spriteId, focusedSprite);

        console.debug(`[${extensionName}] Sprite hidden: ${spriteId}`);
    }

    updateButtonIcon();
}

/**
 * Reset all hidden sprites (called on chat change)
 */
export function resetHiddenSprites() {
    // Stop all observers first
    for (const [spriteId, observer] of spriteObservers.entries()) {
        observer.disconnect();
    }
    spriteObservers.clear();

    // Restore all originals
    for (const [spriteId, originalSrc] of originalSrcMap.entries()) {
        const sprite = $(`#${CSS.escape(spriteId)}`);
        if (sprite.length) {
            const img = getSpriteImage(sprite);
            if (img) {
                img.attr("src", originalSrc);
            }
        }
    }

    hiddenSpriteIds.clear();
    originalSrcMap.clear();
    updateButtonIcon();
    console.debug(`[${extensionName}] Hidden sprites reset`);
}

/**
 * Handle button click
 */
function onHideSpriteClick() {
    toggleHideSprite();
}

/**
 * Create and add the hide sprite button to #rightSendForm
 */
export function setupHideSpriteButton() {
    const addButton = () => {
        if ($("#prome-hide-sprite-btn").length > 0) return; // Already exists

        const $rightSendForm = $("#rightSendForm");
        if (!$rightSendForm.length) return;

        const hideBtn = $(`
            <div id="prome-hide-sprite-btn"
                 class="fa-solid fa-eye interactable"
                 tabindex="0"
                 title="Toggle sprite visibility (Prome)">
            </div>
        `);

        hideBtn.on("click", onHideSpriteClick);
        $rightSendForm.prepend(hideBtn);
        console.log(`[${extensionName}] Hide sprite button added`);
    };

    // Try immediately
    addButton();

    // Also observe for DOM changes
    const observer = new MutationObserver(() => addButton());
    observer.observe(document.body, { childList: true, subtree: true });

    // Stop observing after 10 seconds
    setTimeout(() => observer.disconnect(), 10000);
}

/**
 * Initialize the hide sprite module
 */
export async function initHideSprite() {
    await fetchPlaceholderImages();
}

/**
 * Update button icon when focus changes (call after applyZoom)
 */
export function syncHideSpriteButtonState() {
    updateButtonIcon();
}
