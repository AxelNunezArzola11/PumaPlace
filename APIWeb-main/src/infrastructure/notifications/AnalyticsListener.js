const { EVENTS } = require('../../domain/events/EventBus');

class AnalyticsListener {
  constructor({ eventBus, logger = console } = {}) {
    if (!eventBus) throw new Error('AnalyticsListener requiere un EventBus');
    this.logger = logger;
    this.unsubscribe = Object.values(EVENTS).map((eventName) =>
      eventBus.subscribe(eventName, (payload) => this.track(eventName, payload)));
  }

  track(eventName, payload) {
    this.logger.log(`[analytics] ${eventName}`, payload);
  }

  close() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
  }
}

module.exports = AnalyticsListener;
