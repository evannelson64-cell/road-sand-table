// Small WebXR session wrapper. The headset is the source of truth for whether
// immersive-vr is available; the UI only offers the button when it is.
export class XrSessionManager {
  constructor({ renderer, onStart, onEnd, onSupport, onError }) {
    this.renderer = renderer;
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.onSupport = onSupport;
    this.onError = onError;
    this.session = null;
    this.supported = false;
    this.entering = false;
  }

  async init() {
    if (!navigator.xr || typeof navigator.xr.isSessionSupported !== 'function') {
      this.supported = false;
      this.onSupport(false);
      return false;
    }

    try {
      this.supported = await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      this.supported = false;
    }
    this.onSupport(this.supported);
    return this.supported;
  }

  async enter() {
    if (this.entering || this.session) {
      return false;
    }
    if (!navigator.xr) {
      this.onError('WebXR is not available in this browser.');
      return false;
    }

    this.entering = true;
    let session = null;
    try {
      // Hand tracking is optional. Controllers remain the fallback.
      session = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hand-tracking', 'bounded-floor'],
      });

      session.addEventListener('end', () => {
        this.session = null;
        this.entering = false;
        this.onEnd();
      }, { once: true });

      await this.renderer.xr.setSession(session);
      this.session = session;
      this.renderer.xr.setFoveation?.(0.85);
      await this.onStart(session);
      return true;
    } catch (error) {
      this.entering = false;
      if (session && !session.ended) {
        await session.end().catch(() => {});
      }
      this.onError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async exit() {
    if (this.session) {
      await this.session.end();
    }
  }
}
