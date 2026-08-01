/**
 * Print a standalone HTML document from inside the app.
 *
 * Two things this handles that a naive implementation gets wrong:
 *
 *   1. window.open() is silently blocked by a default browser's pop-up blocker,
 *      so the button appears to do nothing. Renders into an off-screen iframe
 *      instead.
 *   2. Chrome takes the PDF's title — which becomes the suggested filename, and
 *      the page header when headers are enabled — from the TOP-LEVEL document,
 *      not from the frame being printed. This app's title is Bangla, and it
 *      came out of the PDF exporter mangled: "¬¾‡²¾° ¸¹¾¯¼Ł". The title is
 *      therefore swapped for an ASCII one for the duration of the print and put
 *      back afterwards.
 */
export function printFrame(html: string, documentTitle?: string): boolean {
  if (typeof document === 'undefined') return false;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';

  const previousTitle = document.title;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = previousTitle;
  };

  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) { restore(); frame.remove(); return; }
    if (documentTitle) document.title = documentTitle;
    win.focus();
    win.print();
    // The frame has to outlive print() — removing it immediately cancels the
    // job in some browsers — but the title must go back either way.
    restore();
    setTimeout(() => frame.remove(), 2000);
  };

  frame.srcdoc = html;
  document.body.appendChild(frame);
  return true;
}
