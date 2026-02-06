import { extensionName } from "../constants.js";
import { getSpriteList, getExpressionHolderSelector, isExpressionsPlusActive } from "../utils.js";

// State definitions
const SPRITE_STATES = {
    MAIN: 0,
    DUMMY_FEMALE: 1,
    DUMMY_MALE: 2,
    INVISIBLE: 3
};

// In-memory state (per-session only)
let spriteStates = new Map(); // Maps spriteId -> state (0-3)
let originalSrcMap = new Map();
let placeholderImages = [];
let spriteObservers = new Map(); // Track MutationObservers for non-main sprites

// Dummy image tracking
let dummyFemaleImages = [];
let dummyMaleImages = [];
let dummyAvailability = { female: false, male: false };

/**
 * Get sprite path from sprite entry (handles both string and object formats)
 * @param {string|object} sprite
 * @param {string} folderName - Fallback folder name if constructing path manually
 * @returns {string}
 */
function getSpritePath(sprite, folderName) {
    if (typeof sprite === 'string') {
        return `/characters/${folderName}/${sprite}`;
    }
    // SillyTavern API returns objects - prefer 'path' as it includes extension
    if (sprite && typeof sprite === 'object') {
        // 'path' contains full relative path like "/characters/Folder/file.png"
        if (sprite.path) {
            return sprite.path;
        }
        // Fallback to label/name (may lack extension)
        const filename = sprite.label || sprite.name || '';
        return `/characters/${folderName}/${filename}`;
    }
    return '';
}

/**
 * Get the current placeholder path (Invisible state)
 */
function getPlaceholderPath() {
    if (placeholderImages.length > 0) {
        return getSpritePath(placeholderImages[0], 'Placeholder');
    }
    return "";
}

/**
 * Get a random dummy female sprite path
 */
function getDummyFemalePath() {
    if (dummyFemaleImages.length > 0) {
        const randomIndex = Math.floor(Math.random() * dummyFemaleImages.length);
        return getSpritePath(dummyFemaleImages[randomIndex], 'Dummy-Female');
    }
    return "";
}

/**
 * Get a random dummy male sprite path
 */
function getDummyMalePath() {
    if (dummyMaleImages.length > 0) {
        const randomIndex = Math.floor(Math.random() * dummyMaleImages.length);
        return getSpritePath(dummyMaleImages[randomIndex], 'Dummy-Male');
    }
    return "";
}

/**
 * Get sprite path for a given state
 * @param {number} state
 * @param {string} spriteId - Used to get original src for MAIN state
 * @returns {string}
 */
function getSpriteSrcForState(state, spriteId) {
    switch (state) {
        case SPRITE_STATES.MAIN:
            return originalSrcMap.get(spriteId) || "";
        case SPRITE_STATES.DUMMY_FEMALE:
            return getDummyFemalePath();
        case SPRITE_STATES.DUMMY_MALE:
            return getDummyMalePath();
        case SPRITE_STATES.INVISIBLE:
            return getPlaceholderPath();
        default:
            return "";
    }
}

/**
 * Get FontAwesome icon class for a given state
 * @param {number} state
 * @returns {string}
 */
function getIconForState(state) {
    switch (state) {
        case SPRITE_STATES.MAIN:
            return "fa-eye";
        case SPRITE_STATES.DUMMY_FEMALE:
            return "fa-venus";
        case SPRITE_STATES.DUMMY_MALE:
            return "fa-mars";
        case SPRITE_STATES.INVISIBLE:
            return "fa-eye-slash";
        default:
            return "fa-eye";
    }
}

/**
 * Get tooltip text for a given state
 * @param {number} state
 * @returns {string}
 */
function getTooltipForState(state) {
    switch (state) {
        case SPRITE_STATES.MAIN:
            return "Sprite: Main (click to cycle)";
        case SPRITE_STATES.DUMMY_FEMALE:
            return "Sprite: Dummy Female (click to cycle)";
        case SPRITE_STATES.DUMMY_MALE:
            return "Sprite: Dummy Male (click to cycle)";
        case SPRITE_STATES.INVISIBLE:
            return "Sprite: Invisible (click to cycle)";
        default:
            return "Toggle sprite visibility (Prome)";
    }
}

/**
 * Get next state, skipping unavailable dummy states
 * @param {number} current
 * @returns {number}
 */
function getNextState(current) {
    const stateOrder = [
        SPRITE_STATES.MAIN,
        SPRITE_STATES.DUMMY_FEMALE,
        SPRITE_STATES.DUMMY_MALE,
        SPRITE_STATES.INVISIBLE
    ];

    let nextIndex = (stateOrder.indexOf(current) + 1) % stateOrder.length;

    // Skip unavailable states
    while (true) {
        const nextState = stateOrder[nextIndex];

        if (nextState === SPRITE_STATES.DUMMY_FEMALE && !dummyAvailability.female) {
            nextIndex = (nextIndex + 1) % stateOrder.length;
            continue;
        }
        if (nextState === SPRITE_STATES.DUMMY_MALE && !dummyAvailability.male) {
            nextIndex = (nextIndex + 1) % stateOrder.length;
            continue;
        }

        return nextState;
    }
}

/**
 * Apply sprite state to img element
 * @param {string} spriteId
 * @param {jQuery} sprite
 * @param {jQuery} img
 * @param {number} state
 */
function applySpriteState(spriteId, sprite, img, state) {
    const src = getSpriteSrcForState(state, spriteId);

    // Handle INVISIBLE state - use CSS if no placeholder image available
    if (state === SPRITE_STATES.INVISIBLE) {
        if (src) {
            img.attr("src", src);
            img.css("visibility", "visible");
        } else {
            // No placeholder image - hide via CSS
            img.css("visibility", "hidden");
        }
    } else {
        // Non-invisible state - restore visibility and set src
        img.css("visibility", "visible");
        if (src) {
            img.attr("src", src);
        }
    }
}

/**
 * Reapply sprite state to all visible img elements in a sprite container
 * (Called by MutationObserver when ST replaces img elements)
 */
function reapplySpriteState(spriteId) {
    const sprite = $(`#${CSS.escape(spriteId)}`);
    if (!sprite.length) return;

    const state = spriteStates.get(spriteId);
    if (state === undefined || state === SPRITE_STATES.MAIN) return;

    const src = getSpriteSrcForState(state, spriteId);
    const imgs = sprite.find("img");

    imgs.each(function() {
        const $img = $(this);
        const currentSrc = $img.attr("src");

        // Handle INVISIBLE state
        if (state === SPRITE_STATES.INVISIBLE) {
            if (currentSrc) {
                // Store the latest original src
                originalSrcMap.set(spriteId, currentSrc);
            }
            if (src) {
                $img.attr("src", src);
                $img.css("visibility", "visible");
            } else {
                // No placeholder - hide via CSS
                $img.css("visibility", "hidden");
            }
        } else {
            // Non-invisible state
            if (currentSrc && currentSrc !== src) {
                originalSrcMap.set(spriteId, currentSrc);
                if (src) {
                    $img.attr("src", src);
                }
            }
            $img.css("visibility", "visible");
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
        const state = spriteStates.get(spriteId);
        if (state === undefined || state === SPRITE_STATES.MAIN) return;

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
            reapplySpriteState(spriteId);
            console.debug(`[${extensionName}] Re-applied sprite state for: ${spriteId}`);
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
 * Fetch dummy images from Dummy-Female and Dummy-Male folders
 */
async function fetchDummyImages() {
    // Fetch Dummy-Female
    try {
        dummyFemaleImages = await getSpriteList("Dummy-Female");
        dummyAvailability.female = dummyFemaleImages.length > 0;
        console.debug(`[${extensionName}] Dummy-Female images loaded: ${dummyFemaleImages.length}`);
    } catch (err) {
        console.debug(`[${extensionName}] Dummy-Female folder not available:`, err);
        dummyFemaleImages = [];
        dummyAvailability.female = false;
    }

    // Fetch Dummy-Male
    try {
        dummyMaleImages = await getSpriteList("Dummy-Male");
        dummyAvailability.male = dummyMaleImages.length > 0;
        console.debug(`[${extensionName}] Dummy-Male images loaded: ${dummyMaleImages.length}`);
    } catch (err) {
        console.debug(`[${extensionName}] Dummy-Male folder not available:`, err);
        dummyMaleImages = [];
        dummyAvailability.male = false;
    }
}

/**
 * Get the currently focused sprite element (or fallback to any visible sprite)
 * @returns {jQuery|null}
 */
function getFocusedSprite() {
    // Group chat sprites with focus (both vanilla VN and Expressions+)
    const groupFocused = $("#visual-novel-wrapper .prome-sprite-focus, #visual-novel-plus-wrapper .prome-sprite-focus");
    if (groupFocused.length) {
        return groupFocused.first();
    }

    // Solo chat sprite with focus
    const expressionHolderSelector = getExpressionHolderSelector();
    const soloFocused = $(`${expressionHolderSelector}.prome-sprite-focus`);
    if (soloFocused.length) {
        return soloFocused.first();
    }

    // User sprite with focus
    const userFocused = $("#expression-prome-user.prome-sprite-focus");
    if (userFocused.length) {
        return userFocused.first();
    }

    // Fallback: Solo chat sprite without focus class
    const soloSprite = $(expressionHolderSelector);
    if (soloSprite.length && soloSprite.find("img").length) {
        return soloSprite.first();
    }

    // Fallback: Any group sprite without focus class (both vanilla VN and Expressions+)
    const groupSprites = $("#visual-novel-wrapper > div, #visual-novel-plus-wrapper .expression-plus-holder").filter(function() {
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
        btn.removeClass("fa-eye-slash fa-venus fa-mars").addClass("fa-eye");
        btn.attr("title", "Toggle sprite visibility (Prome)");
        return;
    }

    const spriteId = focusedSprite.attr("id");
    const state = spriteStates.get(spriteId) || SPRITE_STATES.MAIN;

    // Remove all state icons
    btn.removeClass("fa-eye fa-eye-slash fa-venus fa-mars");

    // Add current state icon
    btn.addClass(getIconForState(state));
    btn.attr("title", getTooltipForState(state));
}

/**
 * Toggle visibility of the currently focused sprite (cycles through states)
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

    // Get current state (default: MAIN)
    const currentState = spriteStates.get(spriteId) || SPRITE_STATES.MAIN;

    // Store original src if not already stored (only when leaving MAIN state)
    if (currentState === SPRITE_STATES.MAIN) {
        originalSrcMap.set(spriteId, img.attr("src"));
    }

    // Calculate next state
    const nextState = getNextState(currentState);

    // Apply new sprite state
    applySpriteState(spriteId, focusedSprite, img, nextState);

    // Update state tracking
    if (nextState === SPRITE_STATES.MAIN) {
        spriteStates.delete(spriteId);
        originalSrcMap.delete(spriteId);
        // Stop observing when returning to MAIN
        stopObservingSprite(spriteId);
        console.debug(`[${extensionName}] Sprite restored to main: ${spriteId}`);
    } else {
        spriteStates.set(spriteId, nextState);
        // Start/continue observing for non-MAIN states
        observeSpriteChanges(spriteId, focusedSprite);
        console.debug(`[${extensionName}] Sprite state changed to ${nextState}: ${spriteId}`);
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
                img.css("visibility", "visible"); // Restore visibility
            }
        }
    }

    spriteStates.clear();
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
    await fetchDummyImages();
}

/**
 * Update button icon when focus changes (call after applyZoom)
 */
export function syncHideSpriteButtonState() {
    updateButtonIcon();
}
