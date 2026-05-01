// src/iot-sim/mqtt-subscriber.js
'use strict';

const MAX_SUBSCRIPTIONS      = 10;
const MAX_MESSAGES_PER_TOPIC = 500;

class MqttSubscriber {
  constructor() {
    this._client        = null;
    this._subscriptions = new Map();
    this._logCb         = null;
    this._messageCb     = null;
  }

  setClient(mqttClient) {
    this._client = mqttClient;

    this._client.on('connect', () => {
      for (const [topic, sub] of this._subscriptions) {
        this._client.subscribe(topic, { qos: sub.qos });
      }
    });

    this._client.on('message', (topic, payload) => {
      this._handleMessage(topic, payload);
    });
  }

  // ─────────────────────────────────────────────
  // Subscribe / Unsubscribe
  // ─────────────────────────────────────────────

  subscribe(topic, qos = 0) {
    if (!this._client) return { ok: false, error: 'No MQTT client — connect first' };
    if (this._subscriptions.size >= MAX_SUBSCRIPTIONS) {
      return { ok: false, error: `Maximum ${MAX_SUBSCRIPTIONS} subscriptions reached` };
    }
    if (this._subscriptions.has(topic)) {
      return { ok: false, error: `Already subscribed to ${topic}` };
    }

    this._client.subscribe(topic, { qos }, (err) => {
      if (err) {
        this._log(`Subscribe error ${topic}: ${err.message}`, 'err');
      } else {
        this._log(`Subscribed: ${topic} (QoS ${qos})`, 'conn');
      }
    });

    this._subscriptions.set(topic, { qos, messages: [], count: 0 });
    return { ok: true };
  }

  unsubscribe(topic) {
    if (!this._subscriptions.has(topic)) return { ok: false, error: 'Not subscribed' };
    if (this._client) this._client.unsubscribe(topic);
    this._subscriptions.delete(topic);
    this._log(`Unsubscribed: ${topic}`);
    return { ok: true };
  }

  unsubscribeAll() {
    for (const [topic] of this._subscriptions) this.unsubscribe(topic);
  }

  getSubscriptions() {
    const result = [];
    for (const [topic, sub] of this._subscriptions) {
      result.push({ topic, qos: sub.qos, count: sub.count, messages: sub.messages.slice(-20) });
    }
    return result;
  }

  get subscriptionCount() { return this._subscriptions.size; }
  get maxSubscriptions()  { return MAX_SUBSCRIPTIONS; }

  clearMessages(topic) {
    const sub = this._subscriptions.get(topic);
    if (sub) { sub.messages = []; sub.count = 0; }
  }

  clearAllMessages() {
    for (const sub of this._subscriptions.values()) { sub.messages = []; sub.count = 0; }
  }

  // ─────────────────────────────────────────────
  // Message handling
  // ─────────────────────────────────────────────

  _handleMessage(topic, payload) {
    for (const [subTopic, sub] of this._subscriptions) {
      if (this._topicMatches(subTopic, topic)) {
        const raw = payload.toString();
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}

        const msg = { topic, raw, parsed, ts: new Date().toISOString(), isJson: parsed !== null };

        sub.messages.push(msg);
        sub.count++;

        if (sub.messages.length > MAX_MESSAGES_PER_TOPIC) sub.messages.shift();

        if (this._messageCb) this._messageCb(msg);
        break;
      }
    }
  }

  _topicMatches(filter, topic) {
    if (filter === topic) return true;
    const fParts = filter.split('/');
    const tParts = topic.split('/');
    for (let i = 0; i < fParts.length; i++) {
      if (fParts[i] === '#') return true;
      if (fParts[i] === '+') continue;
      if (fParts[i] !== tParts[i]) return false;
    }
    return fParts.length === tParts.length;
  }

  onLog(cb)     { this._logCb     = cb; }
  onMessage(cb) { this._messageCb = cb; }

  _log(msg, type = 'info') {
    if (this._logCb) this._logCb({ ts: new Date().toISOString(), msg, type });
  }
}

module.exports = { MqttSubscriber, MAX_SUBSCRIPTIONS };
