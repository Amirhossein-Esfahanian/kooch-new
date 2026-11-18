// jsdom does not open top-layer popovers. Layout is verified separately in a browser.
export function installNativePopoverStub() {
  Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value(this: HTMLElement) {
    this.style.display = "block";
  } });
  Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value(this: HTMLElement) {
    this.style.display = "none";
  } });
}
