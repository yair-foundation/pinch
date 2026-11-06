/*
 * The landing is in the page's HTML, so it can be read without scripts and anyone new sees it at
 * once (D173). Someone with a session to come back to shouldn't see it first, and the session is in
 * IndexedDB, which can't be read before the first paint. So this key says one is waiting, and a line
 * of script in the page hides the workspace until the session has loaded.
 */
export const HAS_SESSION_KEY = 'pinch-has-session';

export const COMING_BACK_ATTRIBUTE = 'data-coming-back';

export const COMING_BACK_SCRIPT = `try{if(localStorage.getItem('${HAS_SESSION_KEY}'))document.documentElement.setAttribute('${COMING_BACK_ATTRIBUTE}','')}catch(e){}`;
