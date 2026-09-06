// Google Calendar REST 客户端（Worker 侧用 refresh_token 换 access_token）
// 凭据只存在 Worker secret 中，永不进入浏览器、聊天或仓库。
const CAL = 'https://www.googleapis.com/calendar/v3';

export class GoogleCalendar {
  constructor({ clientId, clientSecret, refreshToken }) {
    Object.assign(this, { clientId, clientSecret, refreshToken });
    this._tok = null; this._exp = 0;
  }
  async token() {
    if (this._tok && Date.now() < this._exp - 60000) return this._tok;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId, client_secret: this.clientSecret,
        refresh_token: this.refreshToken, grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw Object.assign(new Error(`google auth ${res.status}`), { code: 401 });
    const j = await res.json();
    this._tok = j.access_token; this._exp = Date.now() + j.expires_in * 1000;
    return this._tok;
  }
  async req(method, path, body, query) {
    const qs = query ? '?' + new URLSearchParams(query) : '';
    const res = await fetch(`${CAL}${path}${qs}`, {
      method,
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 || res.status === 410) return null;
    if (res.status === 204) return { ok: true };
    if (!res.ok) throw Object.assign(new Error(`google ${method} ${path} ${res.status}: ${await res.text()}`), { code: res.status === 401 ? 401 : 500 });
    return res.json();
  }
  listEvents(calendarId, timeMin, timeMax) {
    return this.req('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, null, {
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    });
  }
  getEvent(calendarId, eventId) {
    return this.req('GET', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  }
  createEvent(calendarId, body) {
    return this.req('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, body);
  }
  updateEvent(calendarId, eventId, body) {
    return this.req('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, body);
  }
  deleteEvent(calendarId, eventId) {
    return this.req('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  }
}
