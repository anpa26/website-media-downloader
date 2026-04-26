document.addEventListener('DOMContentLoaded', () => {
    // Cycle through all elements with the 'data-translate' attribute
    document.querySelectorAll('[data-translate]').forEach(element => {
        const key = element.getAttribute('data-translate');
        const translation = browser.i18n.getMessage(key);
        if (translation) {
            element.textContent = translation;
        }
        else {
            console.warn(`Missing translation for key: ${key}`);
        }
    });

    document.querySelectorAll('[data-helper-translate]').forEach(element => {
        const key = element.getAttribute('data-helper-translate');
        const translation = browser.i18n.getMessage(key);
        if (translation) {
            element.setAttribute('helper', translation);
        }
    });
});