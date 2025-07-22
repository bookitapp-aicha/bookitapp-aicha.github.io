/**
 * remove-webflow-badge.js
 *
 * This script continuously monitors the DOM for the presence of the
 * Webflow badge element (with class 'w-webflow-badge') and removes it
 * whenever it appears. It uses a MutationObserver for efficient and
 * real-time detection of DOM changes.
 */

(function() {
    // Function to remove the Webflow badge element
    function removeWebflowBadge() {
        const badge = document.querySelector('.w-webflow-badge');
        if (badge) {
            // Check if the badge's parent is the body or another element
            // and remove it. Using remove() is cleaner than removeChild().
            badge.remove();
            console.log('Webflow badge removed.');
            // Optionally, if you only expect it once, you could disconnect the observer here:
            // observer.disconnect();
        }
    }

    // Create a new MutationObserver instance
    // The callback function will be executed when mutations are observed
    const observer = new MutationObserver(function(mutationsList, observer) {
        // Iterate over the list of mutations (changes)
        for (const mutation of mutationsList) {
            // Check if nodes were added to the DOM
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // If new nodes were added, check if the badge is now present
                removeWebflowBadge();
                // We can break here as we've already tried to remove it once for this batch of changes
                break;
            }
        }
    });

    // Configuration for the observer:
    // - childList: Set to true to observe additions/removals of child nodes
    // - subtree: Set to true to observe changes in the entire DOM subtree
    const observerConfig = { childList: true, subtree: true };

    // Wait for the DOM to be fully loaded before observing the body
    document.addEventListener('DOMContentLoaded', function() {
        // Start observing the document body for configured mutations
        // This ensures that even if the badge is added very late, it will be caught.
        if (document.body) { // Defensive check, though body should exist by DOMContentLoaded
            observer.observe(document.body, observerConfig);
            console.log('MutationObserver started on document.body.');
        } else {
            console.error('Error: document.body not found when attempting to start MutationObserver.');
        }

        // Also call it once immediately in case the badge is already present on initial load
        removeWebflowBadge();
    });

    // For cases where the script might load after DOMContentLoaded,
    // also call it directly when the script runs (though DOMContentLoaded is preferred for observer setup).
    // This line is now primarily for immediate removal if the badge is already present
    // and the DOMContentLoaded event has already fired by the time this script runs.
    removeWebflowBadge();

})();
